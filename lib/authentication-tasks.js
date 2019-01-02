'use strict';

const aws = require('aws-sdk');
const process = require('process');
const fs = require('fs');
const Q = require('q');
const logger = require('winston');

/**
 * Retrieve the user ARN for the specified profile
 * @param profileName - Name of the user profile
 * @returns {Q.Promise}
 */
const getUserARN = (profileName) => {
	// Use the specified profile name
	logger.info(`Retrieving ARN for profile '${profileName}'`);

	return new Q.Promise((resolve, reject) => {
		const iam = new aws.IAM();
		process.env.AWS_PROFILE = profileName;

		// Clear out any pre-existing credentials from the environment variables.
		delete process.env.AWS_ACCESS_KEY_ID;
		delete process.env.AWS_SECRET_ACCESS_KEY;
		delete process.env.AWS_SESSION_TOKEN;

		// Get the user ARN for the profile from AWS
		iam.getUser({}, (err, data) => {
			if (err) {
				console.error(process.env.AWS_PROFILE);
				console.error(process.env.AWS_ACCESS_KEY_ID);
				return reject(err);
			}
			return resolve(data.User.Arn);
		});
	});
};

/**
 * Get temporary AWS session credentials.
 * @param userARN - User ARN of the user that we're getting session credentials for
 * @param MFAToken - Valid MFA token from registered MFA device
 * @param duration - Duration in seconds that the credentials will remain valid.
 * @returns {Q.Promise}
 */
const getSessionCredentials = (userARN, MFAToken, duration) => {
	logger.info('Obtaining session credentials');

	return new Q.Promise((resolve, reject) => {
		const sts = new aws.STS();

		// Set the params using the supplied values
		// Replace the 'user' part of the ARN with 'mfa' to get the MFA device serial number
		let params = {
			DurationSeconds: duration,
			SerialNumber: userARN.replace(':user/', ':mfa/'),
			TokenCode: MFAToken
		};

		// Get session credentials and write them to a .env file.
		sts.getSessionToken(params, (err, data) => {
			if (err) {
				return reject(err);
			}
			fs.writeFile("./.env.session", `AWS_ACCESS_KEY_ID=${data.Credentials.AccessKeyId}\nAWS_SECRET_ACCESS_KEY=${data.Credentials.SecretAccessKey}\nAWS_SESSION_TOKEN=${data.Credentials.SessionToken}`, (err) => {
				if (err) {
					return reject(err);
				}
				logger.info('Session credentials obtained');
				logger.warn('Session credentials will not work if you have equivalent AWS environment variables ' +
					'set in your development environment');
				return resolve();
			});
		});
	});
};

/**
 * Attempts to obtain AWS Session credentials and saves them to a .env file.
 * @param options -
 */
exports.authenticate = function(options) {
	logger.info('Authenticating');
	return getUserARN(options.profile)
		.then((userARN) => {
			return getSessionCredentials(userARN, options.token, options.duration);
		})
		.catch((err) => {
			throw err;
		});
};
