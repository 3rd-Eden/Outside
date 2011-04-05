(function(){
	var socket = new io.Socket();
	socket.connect();
	
	var Manager = function(io){
	    var api = {
	        message: function(type, message){
	          $('<p class="'+ type +'">' + message + '</p>').appendTo('div.messages');
	        },
	        
	        nickname: function(nickname){
	          io.send({type:"nickname", nickname:nickname.toString()});
	        },
	        
	        private: function(to, message){
	           io.send({type:"private", to: to, message: message.toString(), nickname: io.nickname});
	        },
	        
	        blacklist: function(nickname){
	          io.send({type:"blacklist", blacklist:nickname.toString(), nickname: io.nickname});
	        },
	        
	        send: function(message){
	          var request = {type:"message", message: message.toString(), nickname: io.nickname, rooms: io.rooms};
	          io.send(request);
	          api.message("self", replace("<b>You:</b>{message}", request));
	        },
	        
	        notice: function(data){},
	        error: function(data){},
	      	        
	        parser: function(data){
	          if (data.type && typeof data.type === "string"){
	            if (api.parser[data.type]) return api.parser[data.type](data);
	            switch (data.type){
	            
	              case "notice":
	                api.notice(data);
	                break;
	                
	              case "error":
	                api.error(data);
	                break;
	                
	              case "unicorn":
	                io.disconnect();
	                break;
	                
	              case "update":
	                api.update(data);
	                break;
	              
	              default:
	                api.log(data);
	                
	           	}
	          }
	        }
	    };
	    
	    function replace(s,d){
	      for(var p in d) s=s.replace(new RegExp('{'+p+'}','g'), d[p]);
	       return s;
	    };
	    
	    api.parser.private = function(data){};
	    api.parser.message = function(data){
	      api.message("message", replace("<b>{nickname}:</b>{message}", data));
	    };
	    api.parser.update = function(data){
	      if( 'meta' in data ){
	        switch (data.meta){
						// A user changed his nickname
	          case "nick:change":
	            api.message("announcement", replace("{from} changed his nickname to {to}",data));
	            break;
	          
						// A user joined the channel
	          case "user:join":
	            api.message("join", replace("{nickname} joined the chat",data));
	            break;
						
						// A user departed the channel
						case "user:depart":
							api.message("join", replace("{nickname} departed the chat",data));
							break;
	        }
	      } else {
	        if (data.rooms !== io.rooms) io.rooms = data.rooms;
	        if (data.timeleft !== io.timeleft) io.timeleft = data.timeleft;
	        if (data.nickname !== io.nickname) io.nickname = data.nickname;
	      }
	    };
			
	    api.parser.announcement = function(data){
	      $('.message p').remove();
	      api.message("announcement", replace("{message}", data))
	    };
	    
	    return api;
	};
	
	var api = Manager(socket);
	api.nickname("V1" + + new Date());
	socket.on("message", api.parser);
		
	// attach form handling
	$('form[name="box"]').submit(function(e){
    e && e.preventDefault();
    var input = $("input");
    api.send(input.val())
    
    input.val("").focus();
  })
  
  if(location.port == "8908") window.socket = socket;
}());
