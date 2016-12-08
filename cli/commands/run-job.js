'use strict';

var Q = require('q');
var _ = require('lodash');

var config = require('../../config');
var logger = config.logger;

var cliHelpers = require('../helpers');
var deploymentTasks = require('../../lib/deployment-tasks');

module.exports = function(program) {
	program.command('run-job')
	  .arguments('<environment> <job-name>')
		.description('Immediately runs the provided job')
		.action(function(environment, jobName) {
			var runtimeOptions = this.opts();
			runtimeOptions.environment = environment;
			runtimeOptions.job = jobName;
			Q.when(runtimeOptions)
			.then(cliHelpers.setup())
			.then(cliHelpers.lint)
			.then(deploymentTasks.runJob)
			.then(function(data) {
				logger.info('Job is now Running.');
			})
			.catch(function(err) {
				logger.error(err.message);
			});
		});
};
