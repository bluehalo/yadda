'use strict';

const aws = require('aws-sdk');
const process = require('process');
const fs = require('fs');

const Q = require('q');
const logger = require('winston');

const DURATION_MINIMUM = 900;
const DURATION_MAXIMUM = 129600;
const DURATION_DEFAULT = 3600;

const PROFILE_DEFAULT = 'default';

/**
 * Retrieve the user ARN for the specified profile
 * @param profileName - Name of the user profile
 * @returns {Q.Promise}
 */
const getUserARN = (profileName) => {
	// Use the supplied profile name. If no profile name was supplied, use the default profile.
	if (profileName == null) {
		logger.info(`No profile specified. Defaulting profile to '${PROFILE_DEFAULT}'`);
		profileName = PROFILE_DEFAULT;
	}
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
	// If the duration wasn't specified, set it to the default. Otherwise, if it's below/above the min/max, set it to be
	// the min/max accordingly.
	if (duration == null) {
		logger.info(`No session duration specified. Defaulting duration to '${DURATION_DEFAULT}'`);
		duration = DURATION_DEFAULT;
	} else if (duration < DURATION_MINIMUM) {
		logger.info(`Specified session duration '${duration}' is below the AWS duration minimum. Defaulting duration to the minimum of '${DURATION_MINIMUM}'`);
		duration = DURATION_MINIMUM;
	} else if (duration > DURATION_MAXIMUM) {
		logger.info(`Specified session duration '${duration}' is above the AWS duration maximum. Defaulting duration to the maximum of '${DURATION_MAXIMUM}'`);
		duration = DURATION_MAXIMUM;
	}
	return new Q.Promise((resolve, reject) => {
		const sts = new aws.STS();

		// Set the params using the supplied values
		// If the duration was not supplied, use a default duration
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
