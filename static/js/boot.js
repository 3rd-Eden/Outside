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
  Backbone.Events.on = Backbone.Events.bind;
  Backbone.Events.emit = Backbone.Events.trigger;
  Backbone.Events.removeListener = Backbone.Events.unbind;
  Backbone.Events.once = function(event, func){
    var self = this
      /**
       * Removeable shizzle, this is the actual function that gets called
       * and removes it self again from the `Backbone.Events` so it's only
       * called once. This method is the secret sause of a once listener!
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
   * Thanks John; http://ejohn.org/blog/javascript-micro-templating
   * Slightly modified the code to use different template tags as they
   * are clashing with the `ejs` template engine of Node.js. `<% .. %>` 
   * is now `[% .. %]`. Small change, but important!
   *
   * @param {String} str The id attribute of the <script type="text/template> element
   * @param {Object} data The data for the template
   * @return {String} The generated template
   * @api public
   */
  var render = (function(){
    var cache = {}
      , tmpl = function tmpl(str, data){
          // Figure out if we're getting a template, or if we need to
          // load the template - and be sure to cache the result.
          var fn = !/\W/.test(str) ?
            cache[str] = cache[str] ||
              tmpl(document.getElementById(str).innerHTML) :
            
            // Generate a reusable function that will serve as a template
            // generator (and which will be cached).
            new Function("obj",
              "var p=[],print=function(){p.push.apply(p,arguments);};" +
              
              // Introduce the data as local variables using with(){}
              "with(obj){p.push('" +
              
              // Convert the template into pure JavaScript
              str
                .replace(/[\r\t\n]/g, " ")
                .split("[%").join("\t")
                .replace(/((^|%\])[^\t]*)'/g, "$1\r")
                .replace(/\t=(.*?)%\]/g, "',$1,'")
                .split("\t").join("');")
                .split("%]").join("p.push('")
                .split("\r").join("\\'")
            + "');}return p.join('');");
          
          // Provide some basic currying to the user
          return data ? fn( data ) : fn;
        };
          
        return tmpl;
    }());
  
  /**
   * A small user collection 
   */
  var PotentialFriends = Backbone.Collection.extend({
      /**
       * The Backbone.Model that this collection is using, instead of creating
       * a variable for it, I just add it directly in the extend function because
       * all models will be generated by the `collection.add` method.
       */
      model: Backbone.Model.extend({
          url: function(){
            return '/user/' + this.get('nickname');
          }
      })
      
      /**
       * When we are created, we are going to attach event listeners
       * so we can update the users panel when new users join, or leave
       * the chat box. This allows us to automate the process
       */
    , initialize: function(){
        this.bind('add', function(friend){
          // We need to find our self, so we can determin the `type` of this
          // add. If the rooms are not the same as mine or if the user is already
          // in the channel, the type is a personal message.
          var me = this.me()
            , roommate = me ? _.some(friend.attributes.rooms, function(room){
                return _.some(me.attributes.rooms, function(mine){ return mine === room });
              }) : false;
          
          friend = _.clone(friend.attributes);
          friend.me = !me;
          friend.type = me && roommate || !me ? 'user' : 'pm';
          friend.unread = friend.unread || undefined;
          
          $('aside.users .joined').append(render('user', friend));
        });
        
        this.bind('remove', function(friend){
          // because we have an id attached to the element, it will make removing easy
          $('#user_' + friend.attributes.slug).remove();
        })
      }
      /**
       * The `url` property is required, no clue why, because we are not using it anyways
       * @type {String}
       */
    , url: '/users/'
    
      /**
       * Generates a new model and adds it to the collection.
       *
       * @param {Object} details The details / attributes for the model
       * @returns {Backbone.Model} The model that was just added to the collection
       * @api public
       */
    , join: function(details){
        // create a id attribute if it doesn't exist so we can
        // find them this user back
        details.id = details.id || details.nickname;
        
        var friend = new this.model(details);
        this.add(friend);
        
        return friend;
      }
      
      /**
       * Searches the collection for the Model of our current user. This
       * user has a `me` boolean and extra `account` details.
       *
       * @returns {Backbone.Model} The model that is the current user
       * @api public
       */
    , me: function(){
        return this.select(function(friend){ return !!friend.attributes.me && !!friend.account})[0]
      }
      
      /**
       * Search for all Models in the collection that is not `me`
       *
       * @param {Boolean} pm Also return models that belong to a PM
       * @returns {Array} A array with `Backbone.Model`s
       * @api public
       */
    , them: function(pm){
        var me = this.me()
          , them = this.select(function(friend){
            return friend !== me && 
              (!pm && me ? _.some(friend.attributes.rooms, function(room){
                return _.some(me.attributes.rooms, function(mine){ return mine === room });
              }) : true)
          });
        
        return them;
      }
      
      /**
       * Find Models using the `attributes.slug` attribute.
       *
       * @param {String} slug The slug where we need to find a user on.
       * @param {Boolean} all Return all matches, defaults to first result
       * @returns {Array|Backbone.Model}
       * @api public
       */
    , getBySlug: function(slug, all){
        var results = this.select(function(friend){ return friend.attributes.slug == slug });
        return all && results.length > 1 ? results : results[0]
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
      if (response.type && typeof response.type === 'string' && EventedParser.proxy[ response.type ]){
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
      this.io.on('message', this.response);
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
      'check:nickname':   'check:nickname'
    , 'check:email':      'check:email'
    , 'account:created':  'account:created'
    , 'account:details':  'account:details'
      
      // messages
    , 'comment':          'comment'
    , 'announcement':     'announcement'
    , 'private':          'private'
    , 'user:join':        'user:join'
    , 'user:depart':      'user:depart'
    , 'user:roommates':   'user:roommates'
    , 'heartbeat':        'heartbeat'
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
        EventedParser.io.send({type:'nickname', nickname:nickname.toString()});
      },
      
      /**
       * Send a new Private Message
       *
       * @param {String} to The nickname of the user to send the message to
       * @param {String} message The message to the user
       *
       * @api public
       */
      private: function(slug, message){
        var to = Outsiders.getBySlug(slug)
          , request = {type:'private', to: to.attributes.nickname, message: message.toString(), nickname: this.nickname, time: new Date()};
          
        EventedParser.io.send(request);
        EventedParser.trigger('private', request);
      },
      
      /**
       * Blacklist a nickname to prevent them from sending pm
       *
       * @param {String} nickname The nickname that needs to blocked
       *
       * @api public
       */
      blacklist: function(nickname){
        EventedParser.io.send({type:'blacklist', blacklist:nickname.toString(), nickname: this.nickname});
      },
      
      /**
       * Sends a new message to the current chatbox
       *
       * @param {String} message The message that needs to be send to the chatbox
       *
       * @api public
       */
      send: function(message){
        var request = {type:'comment', message: message.toString(), nickname: this.nickname, rooms: this.rooms, time: new Date()};
        
        EventedParser.io.send(request);
        EventedParser.trigger('comment', request);
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
        EventedParser.io.send({type:'validate:check', field:field, value:value})
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
        
        EventedParser.io.send({type: 'account:create', nickname: nickname, email:email });
      },
      
      details: function(slug){
        var user = Outsiders.getBySlug(slug);
        
        EventedParser.io.send({type: 'account:details', nickname:user.attributes.nickname, from: this.nickname});
      }
    }
  };
  _.extend(EventedParser, Backbone.Events);
  
  /**
   * Status allows us to update the Application with different statuses
   * because I didn't want to clutter the Application code with it, I
   * moved it to it's own `Class`.
   *
   * Status contains methods and functionality to notify the user of 
   * `status` updates.
   */
  var Status = {
    /**
     * Is the connected user idling?
     *
     * @type {Boolean}
     * @api public
     */
    idle: false,
    
    /**
     * We need to load in some potentially `heavy` JavaScript code. We need to know when
     * a user is `idle` or no longer actively engaging with the page, we can than notify
     * them of updates that are more visible when you are not staring at the page. Like
     * updating the 
     *
     * @api public
     */
    initialize: function(){
      
      
      // We want to be able to detect when a user goes in `idle` state so we can make
      // updates more visable for the user. For example by updating the `favicon.ico`
      // and document title or even flash the button in IE
      var idle = function(){ if (!Status.idle) Status.emit('idle'); Status.idle = true }
        , active = function(){ if (Status.idle) Status.emit('active'); Status.idle = false }
        , timeout = function(){
          clearTimeout(idleTimer);
          
          // if we are idle, we are now active
          if (Status.idle) active();
          
          idleTimer = setTimeout(idle, 30000);
        }
        , idleTimer;
      
      // Attach the DOM events
      $(window)
        .focus(active)
        .blur(idle)
        .mousemove(timeout)
        .keydown(timeout)
        .bind('touchstart', timeout);
        
      // Add a secret destruction method
      Status.destroy = function(){
        // make sure we our last state was `active`
        if (Status.idle) active();
        Status.idle = false;
        
        // clear the timer, and remove all events
        clearTimeout(idleTimer);        
        $(window).unbind();
        
        // add a new dummy again
        Status.destroy = function(){}
      }
    },
    
    /**
     * This will be replaced once the `initialize` method is called with a function
     * that clears the actions we done on initialization.
     *
     * @api public
     */
    destroy: function(){},
    
    /**
     * Add an annoucment banner the to chat view. This is one of the most `visible` status
     * updates possible.
     *
     * @param {Object} data The message that needs to be displayed
     * @api public
     */
    announce: function(data){
      // add a default title if none exists
      data.title = data.title || 'Announcement';
      
      var announcement = $(render('announcement', data))
      .prependTo('div.boxed-btm form')
      .css({right:1000}) // hide it
      .animate({right:0}, {
        duration: 300
      , complete: function(){
          announcement.addClass('announced')
        }
      });
      
      // remove the annoucement again after x amount of milliseconds 
      setTimeout(function(){announcement.remove()}, data.timeout || 5000);    
    },
    
    update: function(idleOnly){
    
    }
  };
  _.extend(Status, Backbone.Events);  
  
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
      '/':                      'loaded',
      '/signup/service/:type':  'service',
      '/hello/:nickname':       'setup'
    },
    
    /**
     * Establish a connection with the server when a new `Outside` application 
     * has been created. The connection is established using `Socket.IO`
     */
    initialize: function(){
      development && console.log('Application loaded');
      
      this.state = 'auth';
      this.io = new io.Socket(null, { rememberTransport:false });
      this.io.connect();
      this.environment = {};
      
      EventedParser.register(this.io);
      
      var self = this
        , form = $('.auth form').live('submit', function(e){
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
              
              if( !email || !nickname ) return; // return later, so we know all 'validations' are toggled
              
              EventedParser.once('account:created', function(data){
                if( data && data.validates ){
                  
                  // Register a new acount
                  self.me = Outsiders.join({
                    nickname: data.nickname
                  , slug: data.slug
                  , avatar: data.avatar
                  , rooms: data.rooms
                  , me: true // \o/ yup, it's me
                  });
                  
                  self.me.account = data;
                  
                  // Add the canvas timer:
                  $('#thefinalcountdown').pietimer({
                    seconds: data.timeleft / 1000,
                    colour: 'rgba(184, 217, 108, 1)',
                    height: 55,
                    width: 55
                  });
                  
                  // Initialize status so we start polling for idle activity
                  Status.initialize();
                  
                  // update the view
                  window.location.hash = '/hello/' + data.nickname;
                  
                  // Check if there are already some users in the channel, if this is the
                  // case, lets add them :) this needs to be done after we have updated
                  // the location, so a listener has been added in our `setup` method.
                  // setTimout is used to make sure, that the other function is done with
                  // executing
                  if (data.roommates && data.roommates.length){
                    setTimeout(function(){EventedParser.emit('user:roommates', data)},0);
                  }
                } else {
                  alert(data ? data.message : 'Unable to validate the nickname');
                }
              });
              
              EventedParser.API.createAccount(nickname, email);
          }
        });
    },
    
    /**
     * The inital sign up page
     */
    loaded: function(){
      this.state = 'auth';
      $('.auth form').find('.regular').show().end().find('.services').hide();
      
      if (this.environment.initiatedSignup) return;
      
      var self = this
        , form = $('.auth form')
        
        /**
         * Check if our submitted nickname validates on the server
         * When we are checking make sure that the value of the
         * server matches the value of the nickname input. 
         *
         * @param {Object} data The response from the server
         *
         * @api private
         */
      ,  nickvalidate = function(data){
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
         .live('blur', function(){
            EventedParser.removeListener('check:nickname', nickvalidate);
            
            var parent = nickname.parent().removeClass('focus')
              , label = nickname.parents('fieldset').find('label[for="' + nickname[0].id + '"]');
              
            if (nickname.val().length < 3) parent.addClass('invalid') && label.find('span').remove().end().append('<span class="invalid">Your nickname is required</span>');
          })
         .live('focus', function(){
            EventedParser.on('check:nickname', nickvalidate);
            nickname.parent().addClass('focus');
          })
         .live('keyup', function(){
           var value = nickname.val();
           if (value.length >= 3)
             EventedParser.API.check('nickname', value);
         })
         
        /**
         * Checks if we have valid email address, this is also validated on
         * the server side so we can generate a gravatar compatible URL
         */
      ,  emailvalidate = function(data){
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
        
      ,  email = form.find('input[name="email"]')
         .live('blur', function(){
             EventedParser.removeListener('check:email', emailvalidate);
            
            var parent = email.parent().removeClass('focus')
              , label = email.parents('fieldset').find('label[for="' + email[0].id + '"]');
              
            if (!email.val()) parent.addClass('invalid') && label.find('span').remove().end().append('<span class="invalid">Email address is required</span>');
         })
         .live('focus', function(){
             EventedParser.on('check:email', emailvalidate);
         })
         .live('keyup', function(){
             var value = email.val();
            if (value.length >= 3 )
              EventedParser.API.check('email', value);
         });
      
      // we are done, so flag it
      this.environment.initiatedSignup = true;
    },
    
    /**
     * Start the chatbox magic
     */
    setup: function(nickname){
      var self = this
        , me = self.me
        , account = me.account
        , box = $('.box')
        , joined = $('aside.users .joined')
        , pms = $('aside.users footer.pm')
      
      this.state = 'loggedin';
      this.view = 'chat';
      
      // Add the listeners
      EventedParser.on('private', function(data){
        // add more details
        _.extend(data, Outsiders.get(data.nickname).attributes);
        data.type = data.nickname === account.nickname ? 'me' : 'other';
        
        var slug = data.slug
          , panel = self.findPanel(slug)
          , from = Outsiders.get(data.from)
          , pmbutton = pms.find('#pm_' + from.attributes.slug)
          , unread;
        
        // check if we need to add new PM indicator
        if( !pmbutton.length ){
        
        } else {
          unread = pmbutton.find('span');
        }
        
        // make a panel for the messages if they don't exist yet and
        // add the messgae
        panel = panel.length ? panel : self.addPanel(slug);
        $(render('comment', data)).appendTo(panel);
      });
      
      /**
       * Handle `announcements` from the server. These annoucements will let us known that next update
       * will probably clear
       */
      /**
       * When we receive an annoucement from the server, we might need to clear the channel
       */
      EventedParser.on('announcement', function(data){
        // clear all current messages
        if (data.reset){
          // make sure we only delete the chat history, not the private messages
          $('section.messages div.chat article').remove();
          
          var me = Outsiders.me()
            , them = Outsiders.them();
          
          // remove all `friends` so we can make some new friends
          _.forEach(them, function(friend){
            Outsiders.remove(friend);
          });
          
          // update our rooms, as this is used to check against pms
          // and omg i saved a function call by not doing me.set();
          me.attributes.rooms = me.account.rooms = data.rooms;
          
          if (data.roommates && data.roommates.length){
            setTimeout(function(){EventedParser.emit('user:roommates', data)},0);
          }
          
          // update the timer
          $('#thefinalcountdown').pietimer({
            seconds: data.timeleft / 1000,
            colour: 'rgba(184, 217, 108, 1)',
            height: 55,
            width: 55
          });
        }
        
        // display the actual message from the server
        if (data.message) Status.announce(data);
        
      });
      
      /**
       * A new comment has been made by a user, we need to add it to the chat view
       * so it actually get's rendered propperly. 
       */
      EventedParser.on('comment', function(data){
        // add more details
        _.extend(data, Outsiders.get(data.nickname).attributes);
        data.type = data.nickname === account.nickname ? 'me' : 'other';
        
        $(render('comment', data)).appendTo('section.messages div.chat');
      });
      
      /**
       * A new user has joined the room, add them to the outsiders
       */
      EventedParser.on('user:join', function(data){
        Outsiders.join({
          nickname: data.nickname
        ,  avatar: data.avatar
        , rooms: data.rooms // we share the same rooms
        , slug: data.slug
        });
      });
      
      /**
       * When the user leave the channel, we need to remove them
       * from our Outsiders list as well.
       */
      EventedParser.on('user:depart', function(data){
        Outsiders.remove(data.nickname);
      });
      
      /**
       * Also known as a batch join, multiple users are added at once
       * to our Outsiders group.
       */
      EventedParser.on('user:roommates', function(data){
        if (data.roommates && data.roommates.length){
          var i = data.roommates.length;
          while(i--){
            Outsiders.join({
              nickname: data.roommates[i].nickname
            , slug: data.roommates[i].slug
            , avatar: data.roommates[i].avatar
            , rooms: data.rooms // we share the same rooms 
            })
          }
        }
      });
      
      EventedParser.on('user:nickchange', function(){});
      
      // prepare the application interface
      $('#masthead .salut a').html(account.nickname).attr('href', '#/details/' + account.nickname);
      
      /**
       * Attach all event listeners for the chat view, we need to use `live` listener for all 
       * the events. Because we are not reload the application for each view update. So to prevent
       * flooding the browser with event listeners and complicating our application behavior we just
       * do it the save way
       */
      
      /**
       * Attach a submit listener for the form. This allows us to send the mssages to the
       * server.
       *
       * @todo work with different views, so we can also use this for PM messages
       */
      box.find('form[name="chat"]').live("submit", function(e){
        e && e.preventDefault();
        
        var $self = $(this)
          , input = $self.find('input[name="message"]');
        
        if (self.view === 'chat'){
          EventedParser.API.send.call(account,input.val());
        } else {
          EventedParser.API.private.call(account,self.view, input.val());
        }
        input.val(''); // clear the value
      });
      
      /**
       * Attach a listener for the click events on the user buttons, so that we can start sending personal messages
       */
      joined.find('a.message').live("click", function(e){
        e && e.preventDefault();
        
        var user = $(this)
          , nickname = user.html()
          , slug = user.parents('.user').attr('data-slug')
          , me = Outsiders.me()
          , panel = self.findPanel(slug);
        
        // @todo handle this better
        if (me.attributes.slug == slug) return alert('Srsly?? You want to PM your self.. Odd ball');
        
        panel = panel.length ? panel : self.addPanel(slug);
        self.view = slug;
      });
      
      joined.find('a.details').live("click", function(e){
        e && e.preventDefault();
        
        var user = $(this)
          , slug = user.parents('.user').attr('data-slug')
          , me = Outsiders.me();
          
        EventedParser.once("account:details", function(data){
          if (data.message) return Status.announce({message:data.message, title: 'Oh dear'});
          
          console.log("has details :D");
        });
        
        EventedParser.API.details(slug);
      });
      
      // Now that all UI changes are made, we can make the application visable, this way we don't
      // trigger unnessesary reflows + paint events in the browser.
      $('html').addClass('loggedin').find('.auth').hide().end().find('div.app').show();
      
    },
    
    service: function(type){
      this.state = 'auth:service';
      
      alert('zomg, service based logins still fails, login using a normal account, kay?');
      // ignore the awful chaining, this is just a filty hack
      if (!type) 
        $('.auth form').find('.regular').hide().end().find('.services').show();
    },
    
    /**
     * Adds a new panel to the chatbox view
     *
     * @param {String} id The id of the panel
     * @api public
     */
    addPanel: function(id){ return $('<div class="view '+ id +'"></div>').insertBefore('section.messages ol.dots') },
    
    /**
     * Finds the panel inside the chatbox
     *
     * @param {String} id The id of the panel
     * @api public
     */
    findPanel: function(id){ return $('section.box .view.' + id) },
    
    /**
     * Converts
     *
     * @param {String} date_str A ISO date string
     * @returns {String} a pretty date
     * @api public
     */
    pretty: (function(){
      var time_formats = [
        [60, 'just now', 1] // 60
      , [120, '1 minute ago', '1 minute from now'] // 60*2
      , [3600, 'minutes', 60] // 60*60, 60
      , [7200, '1 hour ago', '1 hour from now'] // 60*60*2
      , [86400, 'hours', 3600] // 60*60*24, 60*60
      , [172800, 'yesterday', 'tomorrow'] // 60*60*24*2
      , [604800, 'days', 86400] // 60*60*24*7, 60*60*24
      , [1209600, 'last week', 'next week'] // 60*60*24*7*4*2
      , [2419200, 'weeks', 604800] // 60*60*24*7*4, 60*60*24*7
      , [4838400, 'last month', 'next month'] // 60*60*24*7*4*2
      , [29030400, 'months', 2419200] // 60*60*24*7*4*12, 60*60*24*7*4
      , [58060800, 'last year', 'next year'] // 60*60*24*7*4*12*2
      , [2903040000, 'years', 29030400] // 60*60*24*7*4*12*100, 60*60*24*7*4*12
      , [5806080000, 'last century', 'next century'] // 60*60*24*7*4*12*100*2
      , [58060800000, 'centuries', 2903040000] // 60*60*24*7*4*12*100*20, 60*60*24*7*4*12*100
      ];
      
      return function(date_str){
        var time = ('' + date_str).replace(/-/g,"/").replace(/[TZ]/g," ")
        , seconds = (new Date - new Date(time)) / 1000
        , token = 'ago'
        , list_choice = 1
        , i = 0
        , format;
        
        if (seconds < 0) {
          seconds = Math.abs(seconds);
          token = 'from now';
          list_choice = 2;
        }
        
        while (format = time_formats[i++]){
          if (seconds < format[0]) {
            if (typeof format[2] == 'string'){
              return format[list_choice];
            } else {
              return Math.floor(seconds / format[2]) + ' ' + format[1] + ' ' + token;
            }
          }
        }
        
        return time;
      }
    }())
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
    Application.Status = Status;
    window.Application = Application;
    
    // dummy data, aka OMFG chain madness
    document.domain === "localhost" && $(document.body)
      .find('input[name="nickname"]').val('example' +  Math.random()).end()
      .find('input[name="email"]').val('info@3rd-Eden.com').end()
      .find('.auth form').trigger('submit').end()
  }
}(location.port === '8908'));