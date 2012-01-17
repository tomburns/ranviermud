var Localize = require('localize'),
    util = require('util'),
    ansi = require('sty').parse,
    sprintf = require('sprintf').sprintf,
    LevelUtils = require('./levels').LevelUtils,
    Skills = require('./skills').Skills;

var rooms   = null;
var players = null;
var items   = null;
var npcs    = null;

/**
 * Localization
 */
var l10n = null;
var l10n_file = __dirname + '/../l10n/commands.yml';
// shortcut for l10n.translate
var L  = null;

/**
 * Commands a player can execute go here
 * Each command takes two arguments: a _string_ which is everything the user
 * typed after the command itself, and then the player that typed it.
 */
var Commands = {
	player_commands : {
		commands: function (args, player)
		{
			var commands = [];
			var maxlength = 0;
			for (var command in Commands.player_commands) {
				if (command.length > maxlength) maxlength = command.length;
				commands.push(command);
			}

			for (var i = 1; i < commands.length+1; i++) {
				player[i % 5 === 0? 'say' : 'write'](sprintf('%-' + (maxlength + 1) + 's', commands[i-1]));
			}
		},
		drop: function (args, player)
		{
			var room = rooms.getAt(player.getLocation());
			var item = find_item_in_inventory(args, player, true);

			if (!item) {
				player.sayL10n(l10n, 'ITEM_NOT_FOUND');
				return;
			}

			if (item.isEquipped()) {
				player.sayL10n(l10n, 'ITEM_WORN');
				return;
			}

			player.say(L('ITEM_DROP', item.getShortDesc(player.getLocale())), false);
			room.getNpcs().forEach(function (id) {
				npcs.get(id).emit('playerDropItem', room, player, players, item);
			});

			player.removeItem(item);
			room.addItem(item.getUuid());
			item.setInventory(null);
			item.setRoom(room.getLocation());
		},
		equipment: function (args, player)
		{
			var equipped = player.getEquipped();
			for (var i in equipped) {
				var item = items.get(equipped[i]);
				player.say(sprintf("%-15s %s", "<" + i + ">", item.getShortDesc(player.getLocale())));
			}
		},
		get: function (args, player)
		{
			// No picking stuff up in combat
			if (player.isInCombat()) {
				player.sayL10n(l10n, 'GET_COMBAT');
				return;
			}

			var room = rooms.getAt(player.getLocation());
			if (player.getInventory().length >= 20) {
				player.sayL10n(l10n, 'CARRY_MAX');
				return;
			}

			var item = find_item_in_room(args, room, player);
			if (!item) {
				player.sayL10n(l10n, 'ITEM_NOT_FOUND');
				return;
			}

			item = items.get(item);

			player.sayL10n(l10n, 'ITEM_PICKUP', item.getShortDesc(player.getLocale()));
			item.setRoom(null);
			item.setInventory(player.getName());
			player.addItem(item);
			room.removeItem(item.getUuid());
		},
		inventory: function (args, player)
		{
			player.sayL10n(l10n, 'INV');

			// See how many of an item a player has so we can do stuff like (2) apple
			var itemcounts = {};
			player.getInventory().forEach(function (i) {
				if (!i.isEquipped()) {
					itemcounts[i.getVnum()] ? itemcounts[i.getVnum()] += 1 : itemcounts[i.getVnum()] = 1;
				}
			});

			var displayed = {};
			player.getInventory().forEach(function (i) {
				if (!(i.getVnum() in displayed) && !i.isEquipped()) {
					displayed[i.getVnum()] = 1;
					player.say((itemcounts[i.getVnum()] > 1 ? '(' + itemcounts[i.getVnum()] + ') ' : '') + i.getShortDesc(player.getLocale()));
				}
			});
		},
		look: function (args, player)
		{
			var room = rooms.getAt(player.getLocation());

			if (args) {
				// Look at items in the room first
				var thing = find_item_in_room(args, room, player, true);

				if (!thing) {
					// Then the inventory
					thing = find_item_in_inventory(args, player, true);
				}

				if (!thing) {
					// then for an NPC
					thing = find_npc_in_room(args, room, player, true);
				}

				// TODO: look at players

				if (!thing) {
					player.sayL10n(l10n, 'ITEM_NOT_FOUND');
					return;
				}

				player.say(thing.getDescription(player.getLocale()));
				return;
			}


			if (!room)
			{
				player.sayL10n(l10n, 'LIMBO');
				return;
			}

			// Render the room and its exits
			player.say(room.getTitle(player.getLocale()));
			player.say(room.getDescription(player.getLocale()));
			player.say('');

			// display players in the same room
			players.eachIf(function (p) {
				return (p.getName() !== player.getName() && p.getLocation() === player.getLocation());
			}, function (p) {
				player.sayL10n(l10n, 'IN_ROOM', p.getName());
			});

			// show all the items in the rom
			room.getItems().forEach(function (id) {
				player.say('<magenta>' + items.get(id).getShortDesc(player.getLocale()) + '</magenta>');
			});

			// show all npcs in the room
			room.getNpcs().forEach(function (id) {
				var npc = npcs.get(id);
				var color = 'cyan';
				switch (true) {
				case ((npc.getAttribute('level') - player.getAttribute('level')) > 3):
					color = 'red';
					break;
				case ((npc.getAttribute('level') - player.getAttribute('level')) >= 1):
					color = 'yellow';
					break;
				default:
					color = 'green'
					break;
				}
				player.say('<'+color+'>' + npcs.get(id).getShortDesc(player.getLocale()) + '</'+color+'>');
			});

			player.write('[');
			player.writeL10n(l10n, 'EXITS');
			player.write(': ');
			room.getExits().forEach(function (exit) {
				player.write(exit.direction + ' ');
			});
			player.say(']');
		},
		kill: function (args, player)
		{
			var npc = find_npc_in_room(args, rooms.getAt(player.getLocation()), player, true);
			if (!npc) {
				player.sayL10n(l10n, 'ITEM_NOT_FOUND');
				return;
			}
			if (!npc.listeners('combat').length) {
				player.sayL10n(l10n, 'KILL_PACIFIST');
				return;
			}

			npc.emit('combat', player, rooms.getAt(player.getLocation()), players, npcs, function (success) {
				// cleanup here...
			});
		},
		quit: function (args, player)
		{
			if (player.isInCombat()) {
				player.L10n(l10n, 'COMBAT_COMMAND_FAIL');
				return;
			}

			player.emit('quit');
			player.save(function() {
				players.removePlayer(player, true);
			});
			return false;
		},
		remove: function (args, player)
		{
			thing = find_item_in_inventory(args.split(' ')[0], player, true);
			if (!thing) {
				player.sayL10n(l10n, 'ITEM_NOT_FOUND');
				return;
			}

			if (!thing.isEquipped()) {
				player.sayL10n(l10n, 'ITEM_NOT_EQUIPPED');
				return;
			}

			player.unequip(thing);
		},
		save: function (args, player)
		{
			player.save(function () {
				player.say(L('SAVED'));
			});
		},
		skills: function (args, player)
		{
			var skills = player.getSkills();
			for (var sk in skills) {
				var skill = Skills[player.getAttribute('class')][sk];
				player.say("<yellow>" + skill.name + "</yellow>");

				player.write("  ");
				player.sayL10n(l10n, "SKILL_DESC", skill.description);
				if (typeof skill.cooldown !== "undefined") {
					player.write("  ");
					player.sayL10n(l10n, "SKILL_COOLDOWN", skill.cooldown);
				}
				player.say("");
			}
		},
		tnl: function (args, player)
		{
			var player_exp = player.getAttribute('experience');
			var tolevel    = LevelUtils.expToLevel(player.getAttribute('level'));
			var percent    = (player_exp / tolevel) * 100;

			var bar = new Array(Math.floor(percent)).join("#") + new Array(100 - Math.ceil(percent)).join(" ");
			bar = bar.substr(0, 50) + sprintf("%.2f", percent) + "%" + bar.substr(50);
			bar = sprintf("<bgblue><bold><white>%s</white></bold></bgblue> %d/%d", bar, player_exp, tolevel);

			player.say(bar);
		},
		where: function (args, player)
		{
			player.write(rooms.getAt(player.getLocation()).getArea() + "\r\n");
		},
		who: function (args, player)
		{
			players.each(function (p) {
				player.say(p.getName());
			});
		},
		wield: function (args, player)
		{
			var wield = player.getEquipped('wield');
			if (wield) {
				player.sayL10n(l10n, 'CANT_WIELD', items.get(wield).getShortDesc(player.getLocale()));
				return;
			}
			var thing = args.split(' ')[0];
			thing = find_item_in_inventory(thing, player, true);
			if (!thing) {
				player.sayL10n(l10n, 'ITEM_NOT_FOUND');
				return;
			}
			thing.emit('wield', 'wield', player, players);
		},
	},

	/**
	 * Configure the commands by using a joint players/rooms array
	 * and loading the l10n. The config object should look similar to
	 * {
	 *   rooms: instanceOfRoomsHere,
	 *   players: instanceOfPlayerManager,
	 *   locale: 'en'
	 * }
	 * @param object config
	 */
	configure : function (config)
	{
		rooms   = config.rooms;
		players = config.players;
		items   = config.items;
		npcs    = config.npcs;
		util.log("Loading command l10n... ");
		// set the "default" locale to zz so it'll never have default loaded and to always force load the English values
			l10n = new Localize(require('js-yaml').load(require('fs').readFileSync(l10n_file).toString('utf8')), undefined, 'zz');
			l10n.setLocale(config.locale);
		util.log("Done");

		/**
		 * Hijack translate to also do coloring
		 * @param string text
		 * @param ...
		 * @return string
		 */
		L = function (text) {
			return ansi(l10n.translate.apply(null, [].slice.call(arguments)));
		};
	},

	/**
	 * Command wasn't an actual command so scan for exits in the room
	 * that have the same name as the command typed. Skills will likely
	 * follow the same structure
	 * @param string exit direction they tried to go
	 * @param Player player
	 * @return boolean
	 */
	room_exits : function (exit, player)
	{
		var room = rooms.getAt(player.getLocation());
		if (!room)
		{
			return false;
		}

		var exits = room.getExits().filter(function (e) {
			return e.direction.match(new RegExp("^" + exit));
		});

		if (!exits.length) {
			return false;
		}

		if (exits.length > 1) {
			player.sayL10n(l10n, "AMBIG_EXIT");
			return true;
		}

		if (player.isInCombat()) {
			player.sayL10n(l10n, 'MOVE_COMBAT');
			return;
		}

		move(exits.pop(), player, players);

		return true;
	},
	setLocale : function (locale)
	{
		l10n.setLocale(locale);
	}
};

alias('l',   'look');
alias('inv', 'inventory');
alias('eq',  'equipment');
alias('rem', 'remove');
alias('exp', 'tnl');

exports.Commands = Commands;

/**
 * Move helper method
 * @param object exit See the Room class for details
 * @param Player player
 */
function move (exit, player)
{
	rooms.getAt(player.getLocation()).emit('playerLeave', player, players);

	var room = rooms.getAt(exit.location);
	if (!room)
	{
		player.sayL10n(l10n, 'LIMBO');
		return;
	}

	// Send the room leave message
	players.broadcastIf(exit.leave_message || L('LEAVE', player.getName()), function (p) {
		return p.getLocation() === player.getLocation && p != player;
	});

	players.eachExcept(player, function (p) {
		if (p.getLocation() === player.getLocation()) {
			p.prompt();
		}
	});

	player.setLocation(exit.location);
	// Force a re-look of the room
	Commands.player_commands.look(null, player);

	// Trigger the playerEnter event
	// See example in scripts/npcs/1.js
	room.getNpcs().forEach(function (id) {
		var npc = npcs.get(id);
		npc.emit('playerEnter', room, player, players);
	});

	room.emit('playerEnter', player, players);

};

/**
 * Find an item in a room based on the syntax
 *   things like: get 2.thing or look 6.thing or look thing
 * @param string look_string
 * @param Room   room
 * @param Player player
 * @param boolean hydrade Whether to return the id or a full object
 * @return string UUID of the item
 */
function find_item_in_room (look_string, room, player, hydrate)
{
	hydrate = hydrate || false;
	var thing = parse_dot(look_string, room.getItems(), function (item) {
		return items.get(item).hasKeyword(this.keyword, player.getLocale());
	});

	return thing ? (hydrate ? items.get(thing) : thing) : false;
}

/**
 * Find an npc in a room based on the syntax
 *   things like: get 2.thing or look 6.thing or look thing
 * @param string look_string
 * @param Room   room
 * @param Player player
 * @param boolean hydrade Whether to return the id or a full object
 * @return string UUID of the item
 */
function find_npc_in_room (look_string, room, player, hydrate)
{
	hydrate = hydrate || false;
	var thing = parse_dot(look_string, room.getNpcs(), function (id) {
		return npcs.get(id).hasKeyword(this.keyword, player.getLocale());
	});

	return thing ? (hydrate ? npcs.get(thing) : thing) : false;
}

/**
 * Find an item in a room based on the syntax
 *   things like: get 2.thing or look 6.thing or look thing
 * @param string look_string
 * @param object being This could be a player or NPC. Though most likely player
 * @return string UUID of the item
 */
function find_item_in_inventory (look_string, being, hydrate)
{
	hydrate = hydrate || false;
	var thing = parse_dot(look_string, being.getInventory(), function (item) {
		return item.hasKeyword(this.keyword, being.getLocale());
	});

	return thing ? (hydrate ? thing : thing.getUuid()) : false;
}

/**
 * Parse 3.blah item notation
 * @param string arg    The actual 3.blah string
 * @param Array objects The array of objects to search in
 * @param Function filter_func Function to filter the list
 * @return object
 */
function parse_dot (arg, objects, filter_func)
{
	var keyword = arg.split(' ')[0];
	var multi = false;
	var nth = null;
	// Are they trying to get the nth item of a keyword?
	if (/^\d+\./.test(keyword)) {
		nth = parseInt(keyword.split('.')[0], 10);
		keyword = keyword.split('.')[1];
		multi = true
	}

	var found = objects.filter(filter_func, {
		keyword: keyword,
		nth: nth
	});

	if (!found.length) {
		return false;
	}

	var item = null;
	if (multi && !isNaN(nth) && nth && nth <= found.length) {
		item = found[nth-1];
	} else {
		item = found[0];
	}

	return item;
}

/**
 * Alias commands
 * @param string name   Name of the alias E.g., l for look
 * @param string target name of the command
 */
function alias (name, target)
{
	Commands.player_commands[name] = function () {
		Commands.player_commands[target].apply(null, [].slice.call(arguments))
	};
};