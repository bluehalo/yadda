'use strict';

const authenticationTasks = require('../../lib/authentication-tasks');
const config = require('../../config');
const prompt = require('prompt');
const logger = config.logger;

module.exports = function(program) {
	program.command('authenticate')
		.description('Authenticate')
		.description('Authenticates CLI access to AWS resources for a named profile using an MFA token. When a valid ' +
			'profile from ~/.aws/credentials and the associated MFA Token are supplied, temporary session credentials ' +
			'are saved to ./.env.session. The ./.env.session file will be overwritten every time this command is run with ' +
			'valid credentials.\n\nIf you do not have a ~/.aws/credentials file, run the cli command \'aws configure\' ' +
			'and enter your AWS Access Key ID and Secret Access Key at the prompts. If you already have a ~/.aws/credentials ' +
			'file, you can add new named profiles by appending them to the bottom of the file. Profiles should be in the following format:\n\n' +
			'[PROFILE_NAME]\naws_access_key_id=AWS_ACCESS_KEY_ID\naws_secret_access_key=AWS_SECRET_ACCESS_KEY\n\n' +
			'WARNING: If you have set environment variables in your development environment containing AWS credentials, ' +
			'they may interfere with the authentication process. It is recommended that you unset these before attempting ' +
			'to use this authenticate command.')
		.option('-p, --profile <profile>', 'Profile from ~/.aws/credentials to use.')
		.option('-t, --token <token>', 'MFA Token')
		.option('-d, --duration <duration>', 'Seconds until session credentials expire')
		.action(function() {
			const runtimeOptions = this.opts();
			let promptedOptions = {
				properties: {
					profile: {
						description: 'Profile from ~/.aws/credentials to use',
						type: 'string',
						required: true,
						default: 'default'
					},
					token: {
						description: 'MFA Token',
						pattern: /^[\d]{6}$/,
						type: 'string',
						required: true
					}
				}
			};
			prompt.override = runtimeOptions;
			prompt.start();
			prompt.message = '';
			prompt.get(promptedOptions, (err, options) => {
				options.duration = runtimeOptions.duration;
				authenticationTasks.authenticate(options)
					.catch((err) => {
						logger.error(err.message);
					});
			});
		})
};
