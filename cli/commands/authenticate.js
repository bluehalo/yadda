'use strict';

const authenticationTasks = require('../../lib/authentication-tasks');
const config = require('../../config');
const prompt = require('prompt');
const logger = config.logger;

module.exports = function(program) {
	program.command('authenticate')
		.description('Obtain AWS session credentials using a user profile from  ~/.aws/credentials. If you do not have ' +
			'a ~/.aws/credentials file, run the cli command \'aws configure\' and enter your AWS Access Key ID and ' +
			'Secret Access Key at the prompts.\n\nIf you already have a ~/.aws/credentials file, you can add new user ' +
			'profiles by appending them to the bottom of the file. Profiles should be in the following format:\n\n' +
			'[PROFILE_NAME]\naws_access_key_id=AWS_ACCESS_KEY_ID\naws_secret_access_key=AWS_SECRET_ACCESS_KEY\n\n' +
			'WARNING: If you have set environment variables in your development environment containing AWS credentials, ' +
			'they may interfere with the authentication process. It is recommended that you unset these before attempting ' +
			'to use this authenticate command.')
		.option('-p, --profile <profile>', 'Profile from ~/.aws/credentials to use.')
		.option('-t --token <token>', 'MFA Token')
		.option('-d, --duration <duration>', 'Seconds until session credentials expire')
		.action(function() {
			const runtimeOptions = this.opts();
			let promptedOptions = {
				properties: {
					token: {
						description: 'MFA Token',
						pattern: /^[\d]{6}$/,
						type: 'string',
						required: true
					},
					profile: {
						description: 'Profile from ~/.aws/credentials to use',
						type: 'string',
						required: true,
						default: 'default'
					},
					duration: {
						description: 'Seconds until session credentials expire',
						type: 'integer',
						required: true,
						minimum: 900,
						maximum: 129600,
						message: 'Must be an integer value in range 900-129600',
						default: 3600
					}
				}
			};
			prompt.override = runtimeOptions;
			prompt.start();
			prompt.message = '';
			prompt.get(promptedOptions, (err, options) => {
				console.log(`entered token as ${options.token}`);
				console.log(`entered profile as ${options.profile}`);
				authenticationTasks.authenticate(options)
					.catch((err) => {
						logger.error(err.message);
					});
			});
		})
};
