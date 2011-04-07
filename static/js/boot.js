/**
 * Starts up the whole application.
 *
 * @param {Boolean} development Are we in our development env.
 * @api private
 */
(function(development){
	/**
	 * Add Node.js Event Emitter API compatiblity, just because we are cool like that
	 */
	Backbone.Events.emit = Backbone.Events.trigger;
	Backbone.Events.on = Backbone.Events.bind;
	Backbone.Events.removeListener = Backbone.Events.unbind;
	Backbone.Events.once = function(event, func){
		var self = this
		
			/**
			 * Removeable shizzle
			 */
			, removeable = function(){
				func.apply(this, arguments);
				self.removeListener(event, removeable);
			};
			
		this.on(event, removeable);
	};
	
	/**
	 * Disable the Sync because we are using the socket.io connection for
	 * that. In the future it might be nice to use Socket.IO as Backbone.sync
	 * but for now, to much hassle. Sync is used by collections.. 
	 * 
	 * @type {Function}
	 */
	 Backbone.sync = function(){};
	
	/**
	 * A small user collection 
	 */
	var PotentialFriends = Backbone.Collection.extend({
			model: Backbone.Model.extend({
					url: function(){
						return "/user/" + this.get("nickname");
					}
			})
		,	url: '/users/'
		, join: function(details){
				this.add(new this.model(details));
			}
	});
	
	/**
	 * Evented Socket.IO stream parser
	 */
	var EventedParser = {
		
		/**
		 * Parse responses from the Socket.IO server and emits the correct
		 * event based on the data type
		 * 
		 * @param {Object} response The message from the server
		 * @api public
		 */
		response: function(response){
			development && console.dir( response );
			if (response.type && typeof response.type === "string" && EventedParser.proxy[ response.type ]){
				if ('meta' in response && EventedParser.proxy[response.meta])
					return EventedParser.trigger(EventedParser.proxy[response.meta], response);
				
				return EventedParser.trigger(EventedParser.proxy[response.type], response);
			}
		},
		
		/**
		 * Add the Socket.IO connection to the parser and
		 * connect the response parser to it
		 *
		 * @param {Socket.IO} io Socket.IO connection
		 * @api public
		 */
		register: function(io){
			this.io = io;
			this.io.on("message", this.response);
		},
		
		/**
		 * A list of allowed and available events, mapped to 
		 * different event names.
		 *
		 * @type {Object}
		 * @api public
		 */
		proxy: {
			// validation and registration
			'check:nickname':	 	'check:nickname',
			'account:created':	'account:created',
			
			// messages
			'notice':				'notice',
			'error':				'error',
			
			// user events
			'private' : 		'user:private',
			'unicorn':			'user:disconnect',
			
			// channel events
			'message' : 		'channel:message',
			'announcement': 'channel:announcement',
			'nick:change': 	'channel:nickname',
			'user:join':		'channel:join',
			'user:depart':	'channel:depart',
			
			// status sync
			'update': 			'status:update'
		},
		
		API: {
			/**
			 * Ask for a new nickname.
			 *
			 * @param {String} nickname The new nickname
			 * 
			 * @api public
			 */
			nickname: function(nickname){
				EventedParser.io.send({type:"nickname", nickname:nickname.toString()});
			},
			
			/**
			 * Send a new Private Message
			 *
			 * @param {String} to The nickname of the user to send the message to
			 * @param {String} message The message to the user
			 *
			 * @api public
			 */
			private: function(to, message){
				 io.send({type:"private", to: to, message: message.toString(), nickname: EventedParser.io.nickname});
			},
			
			/**
			 * Blacklist a nickname to prevent them from sending pm
			 *
			 * @param {String} nickname The nickname that needs to blocked
			 *
			 * @api public
			 */
			blacklist: function(nickname){
				io.send({type:"blacklist", blacklist:nickname.toString(), nickname: EventedParser.io.nickname});
			},
			
			/**
			 * Sends a new message to the current chatbox
			 *
			 * @param {String} message The message that needs to be send to the chatbox
			 *
			 * @api public
			 */
			send: function(message){
				var request = {type:"message", message: message.toString(), nickname: io.nickname, rooms: io.rooms};
				io.send(request);
				EventedPaser.emit("channel:message", request)
			}
		},
		
		/**
		 * Sends a check to the server to validate the field and value, this is needed
		 * because we will be working with allot of concurrent users and double values may not
		 * be permitted by the server instance.
		 *
		 * @param {String} field The field that needs to be validated
		 * @param {String} value The value of the field
		 *
		 * @api public
		 */
		check: function(field,value){
			this.io.send({type:"validate:check", field:field, value:value})
		},
		
		/**
		 * Create a new account the server
		 *
		 * @param {String} nickname The nickname for the chat
		 * @param {String} email The email address
		 *
		 * @api public
		 */
		createAccount: function(nickname, email){
			nickname = '' + nickname;
			email = '' + email;
			
			this.io.send({type: "account:create", nickname: nickname, email:email });
		}
	};
	_.extend(EventedParser, Backbone.Events);
	
	/**
	 * Outside, Backbone Controller
	 * 
	 * @constructor
	 * @api public
	 */
	var Outside = Backbone.Controller.extend({
		/**
		 * Setup the routes -> locations
		 */
		routes: {
			"/": 											"loaded",
			"/signup/service/:type": 	"service",
			"/hello/:nickname": 			"setup"
		},
		
		/**
		 * Establish a connection with the server when a new `Outside` application 
		 * has been created. The connection is established using `Socket.IO`
		 */
		initialize: function(){
			development && console.log("Application loaded");
			
			this.state = 'auth';
			this.io = new io.Socket(null, { rememberTransport:false });
			this.io.connect();
			this.environment = {};
			
			EventedParser.register(this.io);
			
			// Add a form handler for the .auth panel because this can be accesed using 2 different urls
			var self = this
				, form = $(".auth form").live("submit", function(e){
						e && e.preventDefault();
						
						var nickname, email;
						if (self.state === 'auth'){
							nickname = form.find('input[name="nickname"]').val();
							email = form.find('input[name="email"]').val();
							
							if (nickname === '') return alert('Nickname is required');
							if (email === '') return alert('Your e-mail address is required');
							
							EventedParser.once("account:created", function(data){
								if( data && data.validates ){
									// Register a new acount
									Outsiders.join({
										nickname: data.nickname
									, avatar: data.avatar
									, rooms: data.rooms
									, me: true // \o/ yup, it's me
									});
									
									// Check if there are already some users in the channel, if this is the
									// case, lets add them :)
									if (data.roommates && data.roommates.length){
										var i = data.roommates.length;
										while(i--){
											Outsiders.join({
												nickname: data.roommates[i].nickname
											,	avatar: data.roommates[i].avatar
											, rooms: data.rooms // we share the same rooms 
											})
										}
									}
									
									// update the view
									$("html").addClass("loggedin").find(".auth").hide().end().find("div.app").show();
								} else {
									alert(data ? data.message : "Unable to validate the nickname")
								}
							});
							
							EventedParser.createAccount(nickname, email);
					}
				})
				
				/**
				 * Check if our submitted nickname validates on the server
				 * When we are checking make sure that the value of the
				 * server matches the value of the nickname input. 
				 *
				 * @param {Object} data The response from the server
				 *
				 * @api private
				 */
			,	autovalidate = function(data){
					if (data.value !== nickname.val() ) return; // out of date
					if ( data.validates ){
						nickname.val(data.nickname); // update with a cleaned nickname
					} else {
						console.log(data.message);
					}
				}
				
				/**
				 * As we require the user to enter a username, it would be quite nice to also
				 * have real time validation of their nickname, we can use the established Socket.IO
				 * connection to send the typed values to the server for processing.. 
				 * 
				 * When a user focuses the nickname input, we will add new listener for the `check:nickname`
				 * notifications. 
				 *
				 * When a user leaves the nickname input, we will remove the assigned listener
				 *
				 * When a user types more than 3 charactures in the input field, we are going to send the data
				 * to the server, where escaping and checking is done.
				 */
			, nickname = form.find('input[name="nickname"]')
				 .live("blur", function(){ EventedParser.removeListener("check:nickname", autovalidate ) })
				 .live("focus", function(){ EventedParser.on("check:nickname", autovalidate)})		
				 .live("keyup", function(){
					 var value = nickname.val();
					 if (value.length >= 3 )
						 EventedParser.check("nickname", value);
				 });
		},
		
		/**
		 * The inital sign up page
		 */
		loaded: function(){
			this.state = 'auth';
			$(".auth form").find(".regular").show().end().find(".services").hide();
			
		},
		
		setup: function(nickname){
			//this.io
		},
		
		
		service: function(type){
			this.state = 'auth:service';
			
			alert("zomg, service fails, login using a normal acount, kay?");
			// ignore the awful chaining, this is just a filty hack
			if (!type) 
				$(".auth form").find(".regular").hide().end().find(".services").show()
		}
	});
		
	/**
	 * Initiate `Outside` application
	 */
	var Application = new Outside()
		, Outsiders = new PotentialFriends();
		
	Backbone.history.start();
	
	// if the hash `#/` isn't set, we are going to load it, so our "loaded" method
	// is called.
	if (!location.hash) Application.saveLocation("/"), Backbone.history.loadUrl();
	
	// only expose an external API when we are in development mode
	if (development){
		Application.Outsiders = Outsiders;
		window.Application = Application;
	}
}(location.port === "8908"));