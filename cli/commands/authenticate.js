'use strict';

const authenticationTasks = require('../../lib/authentication-tasks');
const config = require('../../config');
const logger = config.logger;

module.exports = function(program) {
	program.command('authenticate')
		.description('Obtain AWS session credentials and set them as environment variables.')
		.option('-p, --profile <profile>', 'Profile to use to obtain session credentials')
		.option('-t --token <token>', 'MFA Token')
		.option('-d, --duration <duration>', 'Seconds until session credentials expire')
		.action(function() {
			const runtimeOptions = this.opts();
			if (runtimeOptions.token == null) {
				logger.error('Missing required option \'--token\'');
			} else {
				authenticationTasks.authenticate(runtimeOptions)
					.catch((err) => {
						logger.error(err.message);
					});
			}
		})
};
