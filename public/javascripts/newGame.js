'use strict';
$('#singleGameButton').click(function(event) {

	var href = '/mobile/game';

    function getLocation() {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(showPosition);
        } else {
            console.log('Geolocation is not supported by this browser.');
        }
    }

    function showPosition(position) {
    	var lon = position.coords.longitude,
    		lat = position.coords.latitude;

    	//send userId lon and lat to server
        $.post('/user/game/createHunt', {
            'lon': position.coords.longitude,
            'lat': position.coords.latitude,
            'user': 'dummy'
        }, function(data) {
            alert('Game id: ' + data);
        	window.location = href;
        }, 'json');
    }


    //getLocation, send it to server and create new game
    getLocation();
});