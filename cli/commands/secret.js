'use strict';

var Q = require('q');

var config = require('../../config');
var logger = config.logger;

var cliHelpers = require('../helpers');

var secretTasks = require('../../lib/secret-tasks');

module.exports = function(program) {
	program.command('secret')
		.arguments('<environment>')
		.arguments('<action>')
		.arguments('<secret> [secret_value]')
		.option('-c, --context [env]', 'KMS Context in JSON format', null)
		.option('-n, --sversion [ver]', 'Secret version', null)
		.description('Interact with the secret storage\n' +
			'\taction: put|get|delete')
		.action(function(environment, action, secret, secret_value) {
			var runtimeOptions = this.opts();
			runtimeOptions.environment = environment;
			runtimeOptions.secretParams = {
				secret: secret,
				value: secret_value,
				version: runtimeOptions.sversion,
				context: runtimeOptions.context,
			};
			runtimeOptions.action = action.toLowerCase();

			if(typeof runtimeOptions.context === 'string')
				runtimeOptions.context = JSON.parse(runtimeOptions.context);

			Q.when(runtimeOptions)
				.then(cliHelpers.setup())
				.then(cliHelpers.lint)
				.then(secretTasks.verify)
				.then(secretTasks.setupSecretCenter)
				.then(function(options){
					switch(action){
						case 'get': return secretTasks.getSecret(options);
						case 'put': return secretTasks.putSecret(options);
						case 'delete': return secretTasks.deleteSecret(options);
					}

					throw new Error("`"+action+"` is not a defined action for secrets");
				})
				.catch(function (err) {
					logger.error(err.message);
				});
		});
};
