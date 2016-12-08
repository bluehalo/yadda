'use strict';

var Q = require('q');
var _ = require('lodash');

var config = require('../../config');
var logger = config.logger;

var cliHelpers = require('../helpers');
var deploymentTasks = require('../../lib/deployment-tasks');

module.exports = function(program) {
	program.command('rollback')
		.description('rollback to parent deployment for the current deployment')
		.arguments('<environment>')
		.action(function(environment) {
			var runtimeOptions = this.opts();
			runtimeOptions.environment = environment;
			Q.when(runtimeOptions)
			.then(cliHelpers.setup())
			.then(cliHelpers.lint)
			.then(deploymentTasks.rollback)
			.catch(function (err) {
				logger.error(err.message);
			});

		});
};
