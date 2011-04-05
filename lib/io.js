module.exports = function(constructor){
	var io = constructor.Listener.prototype;
	
	/**
	 * Publishes messages over variouse of channels
	 *
	 * @param {Socket.IO.Client} current The client that sends the message
	 * @param {Array} rooms The rooms that receive the message
	 * @param {Mixed} message The message for the channel
	 * @returns {Socket.IO.Listener}
	 * @api public
	 */
	io.publish = function(current, rooms, message){
		var keys = Object.keys( this.clients )
			,		i = keys.length
			,		client;
			
			while( i-- ){
				// reduce lookups
				client = this.clients[ keys[i] ];
				if( client === current ) continue;
				
				if (client && client.rooms && client.rooms.some(function(room){ 
							return rooms.indexOf(room) !== -1
						}))
				{
					client.send(message);
				}
			}
			
			return this;
	};
};