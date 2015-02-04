'use strict';

$( document ).ready(function() {
    getStats();
});

$('#mediaQCheck').click(function(){
	getStats();
});

function getStats(){
	$.getJSON('/user/statistics', function(stats){
    	var geoHunt = stats.geoHunt,
    		mediaQ = stats.mediaQ,
    		tasks = stats.tasks,
    		formattedStats = '<p> Username: ' + geoHunt.userName + '</p>' +
    						 '<p> Uploaded Videos: ' + mediaQ['Uploaded Videos'] + '</p>' +
    						 '<p> Last Activity Date: ' + new Date(mediaQ.LastActivityDate) + '</p>' +
    						 '<p> Global number of tasks: ' + tasks.count + '</p>';
    	$('#stats').html(formattedStats);
    });
}