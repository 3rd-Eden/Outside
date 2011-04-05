/**
 * A small manager function that would allow us to subsribe
 * and upgrade our internal rooms collection to 3 user room.
 *
 * @param {Socket.IO.Instance} io The result of constructing a Socket.IO server
 * @returns {Object} The API
 * @api public 
 */
var Manager = module.exports = function(io){
	/**
	 * The interval for the channel reset
	 *
	 * @type {Number}
	 * @const
	 */
	var interval = 1000*60*3
		, expected = Date.now() + interval
		
		// hash with all rooms based on person count
		, rooms = {
				one:[]
			, two:[]
			, three:[]
		};
	
	/**
	 * Generate a random room name.
	 *
	 * @param {String} pattern A pattern in x y format
	 * @returns {String} generated random string
	 * @api private
	 */
	function generate(pattern){
		pattern = pattern || "xxxxxxxxyxxxyxxx";
		return pattern.replace(/[xy]/g, function(c) {
				var r = Math.random() *16  |0, v = c == 'x' ? r : ( r&0x3 | 0x8 );
				return v.toString( 16 );
		}).toUpperCase();
	};
	
	/**
	 * Sorts an array completely random. So we can assign the users
	 *
	 * @param {Array} array The array that needs to be sorted
	 * @returns {Array} Sorted array
	 * @api private
	 */
	function randoms(array){
			var tmp
				, current
				, top = array.length;
	
			if(top)
				while(--top) {
						current = Math.floor(Math.random() * (top + 1));
						tmp = array[current];
						array[current] = array[top];
						array[top] = tmp;
				}
	
			return array;
	};
	
	/**
	 * Creates a key/value map for Socket.IO session ids => nicknames.
	 *
	 * @param {Boolean} backwards Return nick => id instead of id => nick list
	 * @returns {Object} key/value map
	 * @api public
	 */
	function nickmap(backwards){
		var clients = io.clients
			, keys = Object.keys(clients)
			, i = keys.length
			, map = {}
			, nick;
			
		while (i--){
			nick = clients[keys[i]].nickname || keys[i];
			map[backwards ? nick : keys[i]] = backwards ? keys[i] : nick;
		}
		
		return map;
	};
	
	var api = {
		/**
		 * Upgrades room names to a new level, this should be done when a new user
		 * joins the manager. So we can distrubute the users over the channels
		 * and fill them up 3 users.
		 *
		 * @param {String} name The name of the room that needs to promoted
		 * @api public
		 */
		promote: function(name){
			var index;
			if ((index = rooms.one.indexOf(name)) && index !== -1 || index === 0){
				rooms.one.splice(index,1);
				rooms.two.push(name);
			} else if((index = rooms.two.indexOf(name)) && index !== -1 || index === 0){
				rooms.two.splice(index,1);
				rooms.three.push(name);
			} else {
				rooms.one.push(name);
			}
		},
		
		/**
		 * When a user leaves a room, we need to degrade a room so we can fill it
		 * up again when more users are joining.
		 *
		 * @param {String} name The name of the channel tha needs to be degraded
		 * @api public
		 */
		degrate: function(name){
			var index;
			if ((index = rooms.one.indexOf(name)) && index !== -1 || index === 0){
				rooms.one.splice(index,1);
			} else if((index = rooms.two.indexOf(name)) && index !== -1 || index === 0){
				rooms.two.splice(index,1);
				rooms.one.push(name);
			} else if((index = rooms.three.indexOf(name)) && index !== -1 || index === 0){
				rooms.three.splice(index,1);
				rooms.two.push(name);
			}
		},
		
		/**
		 * Subscribe a user to a room, try to fill up all rooms first so we will reach
		 * our 3 users per channel achievement. When there are no rooms available to join
		 * we generate a new room.
		 *
		 * @param {Socket.IO Client} user The user that needs to have a room assigned
		 * @api public
		 */
		subscribe: function(user){
			var room;
			user.rooms = user.rooms || [];
			
			rooms.two.some(function(i){
				var o = user.rooms.indexOf(i) === -1;
				room = o ? i : o;
				return !!room;
			});
			
			if(!room){
				rooms.one.some(function(i){
					var o = user.rooms.indexOf(i) === -1;
					room = o ? i : o;
					return !!room;
				});
			}
			
			if(!room) room = generate();
		
			// add users to rooms
			api.promote(room);
			user.rooms.push(room);
			
			return // user.rooms.length < 3 ? api.subscribe(user) : user;
		},
		
		/**
		 * When a user disconnects from Socket.IO we need to notify the manager
		 * that we have have some free space in a new room.
		 *
		 * @param {Socket.IO Client} user The user that needs his rooms to be removed
		 * @api public
		 */
		unsubscribe: function(user){
			user.rooms && user.rooms.forEach(function(room){ api.degrate(room) });
			delete user.rooms;
		},
		
		/**
		 * Hussle the current connected users and assign them to new rooms
		 *
		 * @api public
		 */
		reset: function(){
			rooms.one.length = rooms.two.length = rooms.three.length = 0;
			
			var clients = io.clients
				, keys = Object.keys(clients)
				, i = keys.length
				, user;
				
			keys = randoms(keys);
			
			while( i-- ){
				user = clients[keys[i]];
				
				// Reset the current assigned rooms
				user && user.rooms && (user.rooms.length = 0);
				
				// Subscribe to a new room
				api.subscribe(user);
				
				// Notify the user
				api.update(user);
			}
		},
		
		/**
		 * Sends an update to client with the current rooms, nickname and other
		 * usefull stats.
		 *
		 * @param {Socket.IO.Client} user The user that receives an update
		 * @api public
		 */
		update: function(user){
			user.send(api.filter({
					type: "update"
				, nickname: user.nickname
			}, user));
		},
		
		/**
		 * Filter the message from the user to prevent odd injections.
		 *
		 * @param {Object} obj The message object that needst to be updated and checked
		 * @param {Socket.IO.Client} user The user that sends the message
		 * @returns {Object} The filterd object
		 * @api public
		 */
		filter: function(obj, user){
			obj.timeleft = api.timeleft;
			obj.rooms = obj.rooms || user.rooms;
			if (obj.message) obj.message = obj.message;
			
			return obj;
		},
		
		/**
		 * Checks if a nickname is already taken.
		 *
		 * @param {String} nick The nickname that
		 * @api public
		 */
		nickname: function(nick){
			return nickmap(true)[nick];
		},
		
		/**
		 * Sends a private message to a user.
		 *
		 * @param {Object} obj The message Object
		 * @param {Socket.IO.Client} client The user who sends the message
		 * @api public
		 */
		private: function(obj, client){
			if (!obj.to || obj.to === client.nickname ) return;
			
			var target_id = nickmap(true)[obj.to]
				, target = io.clients[target_id];
				
			if (target){
				if (target && target.blacklist && target.blacklist.indexOf(client.nick) !== -1)
					return client.send({type:"error", message:"Blacklisted"});
					
				target.send(api.filter({type:"private", message: obj.message, from: client.nickname}, client));
			}
		},
		
		/**
		 * Adds a nickname to a users blacklist so they will not receive private messages
		 * from that user.
		 *
		 * @param {String} nick The nickname that needs to be blacklisted
		 * @param {Socket.IO.Client} client The user who wants to blacklist a nickname
		 * @api public
		 */
		blacklist: function(nick, client){
			client.blacklist = client.blacklist || [];
			if (client.blacklist.indexOf(nick) !== -1) client.blacklist.push(nick);
		},
		
		/**
		 * Returns an array with all users
		 *
		 * @returns {Array} All nicknames of the users
		 * @api public
		 */
		users: function(){
				return Object.keys(nickmap(true));
		},
		
		/**
		 * The room list.
		 *
		 * @type {Object}
		 * @api public
		 */
		rooms: rooms
	};
	
	// return the timeleft before we swap rooms 
	Object.defineProperty( api, 'timeleft', {
		get: function(){
			var diff = expected - Date.now();
			return diff >= 0 ? diff : 0;
		}
	});

	api.interval = setInterval(function(){
		expected = Date.now() + interval
		io.broadcast({
			type: "announcement"
		,	message: "Shuffling the rooms"
		});
		
		api.reset();
	}, interval);
	
	return api;
};