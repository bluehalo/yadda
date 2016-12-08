'use strict';

var Q = require('q');
var _ = require('lodash');

var config = require('../../config');
var logger = config.logger;

var cliHelpers = require('../helpers');
var deploymentTasks = require('../../lib/deployment-tasks');

module.exports = function(program) {
	program.command('list-jobs')
		.arguments('<environment>')
		.description('List all jobs defined in the Manifest for this environment')
		.action(function(environment) {
			var runtimeOptions = this.opts();
			runtimeOptions.environment = environment;
			Q.when(runtimeOptions)
			.then(cliHelpers.setup())
			.then(cliHelpers.lint)
			.then(deploymentTasks.listJobs)
			.then(function(jobs) {
				logger.info('All jobs:');
				_.each(jobs, function(job) {
					logger.info('\t-', job);
				});
			})
			.catch(function (err) {
				logger.error(err.message);
			});
		});
};
