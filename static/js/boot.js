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
				var friend = new this.model(details);
				this.add(friend);
				
				return friend;
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
			'check:email':			'check:email',
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
			
			var self = this
				, form = $(".auth form").live("submit", function(e){
						e && e.preventDefault();
						
						var nickname, email;
						if (self.state === 'auth'){
							nickname = form.find('input[name="nickname"]').val();
							email = form.find('input[name="email"]').val();
							
							if (!nickname){
								$('.auth label[for="nickname"]').find('span').remove().end().append('<span class="invalid">Nicknames are required</span>').next().addClass('invalid')
							}
							if (!email){
								$('.auth label[for="email"]').find('span').remove().end().append('<span class="invalid">Email address is required</span>').next().addClass('invalid')
							}
							
							if( !email || !nickname ) return; // return later, so we know all "validations" are toggled
							
							EventedParser.once("account:created", function(data){
								if( data && data.validates ){
									// Register a new acount
									this.me = Outsiders.join({
										nickname: data.nickname
									, avatar: data.avatar
									, rooms: data.rooms
									, me: true // \o/ yup, it's me
									});
									
									this.me.account = data;
									
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
									window.location.hash = "/hello/" + data.nickname;
								} else {
									alert(data ? data.message : "Unable to validate the nickname");
								}
							});
							
							EventedParser.createAccount(nickname, email);
					}
				});
		},
		
		/**
		 * The inital sign up page
		 */
		loaded: function(){
			this.state = 'auth';
			$(".auth form").find(".regular").show().end().find(".services").hide();
			
			if (this.environment.initiatedSignup) return;
			var self = this
				, form = $(".auth form")
				
				/**
				 * Check if our submitted nickname validates on the server
				 * When we are checking make sure that the value of the
				 * server matches the value of the nickname input. 
				 *
				 * @param {Object} data The response from the server
				 *
				 * @api private
				 */
			,	nickvalidate = function(data){
					if (data.value !== nickname.val() ) return; // out of date
					
					var parent = nickname.parent()
						, label = nickname.parents('fieldset').find('label[for="' + nickname[0].id + '"]');
					
					// remove old instance
					label.find('span').remove();
									
					if (data.validates){
						nickname.val(data.nickname); // update with a cleaned nickname
						parent.removeClass('invalid').addClass('valid');
						label.append('<span class="valid">Nickname available</span>');
						$('.auth dd.nickname').html(data.nickname);
					} else {
						parent.removeClass('valid').addClass('invalid');
						label.append('<span class="invalid">' + data.message + '</span>');
						$('.auth dd.nickname').html('Anonymous!');
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
				 .live("blur", function(){
						EventedParser.removeListener("check:nickname", nickvalidate);
						
						var parent = nickname.parent().removeClass('focus')
							, label = nickname.parents('fieldset').find('label[for="' + nickname[0].id + '"]');
							
						if (nickname.val().length < 3) parent.addClass('invalid') && label.find('span').remove().end().append('<span class="invalid">Your nickname is required</span>');
					})
				 .live("focus", function(){
				 	  EventedParser.on("check:nickname", nickvalidate);
						nickname.parent().addClass('focus');
					})
				 .live("keyup", function(){
					 var value = nickname.val();
					 if (value.length >= 3)
						 EventedParser.check("nickname", value);
				 })
				 
				/**
				 * Checks if we have valid email address, this is also validated on
				 * the server side so we can generate a gravatar compatible URL
				 */
			,	emailvalidate = function(data){
					if (data.value !== email.val() ) return; // out of date
					
					var parent = email.parent()
						, label = email.parents('fieldset').find('label[for="' + email[0].id + '"]');
					
					// remove old instance
					label.find('span').remove();
									
					if (data.validates){
						parent.removeClass('invalid').addClass('valid');
						label.append('<span class="valid">Valid e-mail address</span>');
						$('.auth dd.gravatar img').attr('src', data.gravatar);
					} else {
						parent.removeClass('valid').addClass('invalid');
						label.append('<span class="invalid">' + data.message + '</span>');
						$('.auth dd.gravatar img').attr('src', '/i/anonymous.png');
					}
				}
				
			,	email = form.find('input[name="email"]')
				 .live("blur", function(){
				 		EventedParser.removeListener("check:email", emailvalidate);
						
						var parent = email.parent().removeClass('focus')
							, label = email.parents('fieldset').find('label[for="' + email[0].id + '"]');
							
						if (!email.val()) parent.addClass('invalid') && label.find('span').remove().end().append('<span class="invalid">Email address is required</span>');
				 })
				 .live("focus", function(){
				 		EventedParser.on("check:email", emailvalidate);
				 })
				 .live("keyup", function(){
				 		var value = email.val();
					  if (value.length >= 3 )
						  EventedParser.check("email", value);
				 });
			
			// we are done, so flag it
			this.environment.initiatedSignup = true;
		},
		
		/**
		 * Start the chatbox magic
		 */
		setup: function(nickname){
			this.state = 'loggedin';
			$("html").addClass("loggedin").find(".auth").hide().end().find("div.app").show();
		},
		
		service: function(type){
			this.state = 'auth:service';
			
			alert("zomg, service fails, login using a normal acount, kay?");
			// ignore the awful chaining, this is just a filty hack
			if (!type) 
				$(".auth form").find(".regular").hide().end().find(".services").show();
		}
	});
	
	// reset hash state
	window.location.hash = '#/';
	/**
	 * Initiate `Outside` application
	 */
	var Application = new Outside()
		, Outsiders = new PotentialFriends();
		
	Backbone.history.start();
	
	// only expose an external API when we are in development mode
	if (development){
		Application.Outsiders = Outsiders;
		window.Application = Application;
		
		// dummy data, aka OMFG chain madness
		false && $(document.body)
			.find('input[name="nickname"]').val('example').end()
			.find('input[name="email"]').val('info@3rd-Eden.com').end()
			.find('.auth form').trigger('submit').end()
	}
}(location.port === "8908"));