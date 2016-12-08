'use strict';

var Q = require('q');
var _ = require('lodash');

var config = require('../../config');
var logger = config.logger;

var cliHelpers = require('../helpers');
var deploymentTasks = require('../../lib/deployment-tasks');

module.exports = function(program) {
	program.command('build')
		.arguments('<environment>')
		.description('build based on the Dockerfile in the provided path')
		.option('-f, --file <manifest file>', 'Deployment manifest file to use for this deployment')
		.option('--tag <tag>', 'Image tag')
		.action(function(environment) {
			var runtimeOptions = this.opts();
			runtimeOptions.environment = environment;
			Q.when(runtimeOptions)
			.then(cliHelpers.setup(cliHelpers.promptForMissingOptions))
			.then(cliHelpers.lint)
			.then(deploymentTasks.build)
			.catch(function (err) {
				logger.error(err.message);
			});
		});
};
