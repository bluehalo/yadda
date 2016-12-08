'use strict';

var Q = require('q');
var _ = require('lodash');

var fs = require('fs');
var path = require('path');
var ncp = require('ncp');

var config = require('../../config');
var logger = config.logger;

var cliHelpers = require('../helpers');

module.exports = function(program) {
	program.command('init')
		.description('creates a skeleton deployment manifest and environments in the current directory')
		.action(function() {
			var exampleDeploymentDirectory = path.resolve(__dirname + '/../../example/deployment');
			ncp(exampleDeploymentDirectory, process.cwd() + '/deployment', function(err) {
				if (err) {
					logger.error(err);
				} else {
					logger.info('Deployment Files created. Please modify the files for your project before deploying');
				}
			});
		});
};
