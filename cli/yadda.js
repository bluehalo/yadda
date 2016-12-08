#!/usr/bin/env node

'use strict';
var program = require('commander');
var path = require('path');
var fs = require('fs');

var commands = fs.readdirSync(path.resolve(path.join(__dirname,'./commands')));

commands.forEach(function(commandFile) {
	require('./commands/' + commandFile)(program);
});

function printHelp() {
	program.help();
}

// Print help if unknown command is provided
program.command('*','',{ noHelp: true })
	.action(printHelp);

program.parse(process.argv);

// Print help if no command is provided
if (process.argv.length === 2) {
	printHelp();
}
