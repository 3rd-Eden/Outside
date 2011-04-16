// src: https://github.com/knorthfield/pietimer/blob/master/jquery.pietimer.js + small global fix for the interval
(function( $ ){
jQuery.fn.pietimer = function( options, callback ) {
	var settings = {
		'seconds': 10,
		'colour': 'rgba(255, 255, 255, 0.8)',
		'height': this.height(),
		'width': this.width()
	};

	if ( options ) { 
		$.extend( settings, options );
	}

	this.html('<canvas id="pie_timer" width="'+settings.height+'" height="'+settings.height+'"></canvas>');

	var val = 360
		, interval = setInterval(timer, 40);

	function timer(){

		var canvas = document.getElementById('pie_timer'); 

		if (canvas.getContext){

			val -= ( 360 / settings.seconds ) / 24;

			if ( val <= 0 ){

				clearInterval(interval);
				canvas.width = canvas.width;
				if(typeof callback == 'function'){
					callback.call();
				}

			} else {

				canvas.width = canvas.width;

				var ctx = canvas.getContext('2d');

				var canvas_size = [canvas.width, canvas.height];
				var radius = Math.min(canvas_size[0], canvas_size[1]) / 2;
				var center = [canvas_size[0]/2, canvas_size[1]/2];

				ctx.beginPath();
				ctx.moveTo(center[0], center[1]);
				var start = ( 3 * Math.PI ) / 2;
				ctx.arc(
					center[0],
					center[1],
					radius,
					start - val * ( Math.PI / 180 ),
					start,
					false
				);

				ctx.closePath();
				ctx.fillStyle = settings.colour;
				ctx.fill();

			}

		}

	}

	return this;

};

})( jQuery );