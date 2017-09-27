'use strict';

var Q = require('q');

var config = require('../../config');
var logger = config.logger;

var cliHelpers = require('../helpers');

var secretTasks = require('../../lib/secret-tasks');

module.exports = function(program) {
	program.command('secret-list')
		.arguments('<environment>')
		.description('List all secrets in an environment')
		.action(function(environment) {
			var runtimeOptions = this.opts();
			runtimeOptions.environment = environment;

			Q.when(runtimeOptions)
				.then(cliHelpers.setup())
				.then(cliHelpers.lint)
				.then(secretTasks.verify)
				.then(secretTasks.setupSecretCenter)
				.then(secretTasks.listSecrets)
				.catch(function (err) {
					logger.error(err.message);
				});
		});
};
