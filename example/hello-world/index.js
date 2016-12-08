'use strict';

const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

app.get('/', function(req, res) {
	var greeting = process.env.CUSTOM_MESSAGE || 'Hello, world';
	var location = process.env.DEPLOYMENT_ENVIRONMENT_NAME || 'Local';
	res.send(greeting + ' from ' + location);
})
.listen(PORT, function() {
	console.log('Server listening on 127.0.0.1:' + PORT);
});
