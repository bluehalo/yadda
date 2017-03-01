'use strict';

var path = require('path');
var Q = require('q');
var fs = require('fs');
var _ = require('lodash');
var git_state = require('git-state');
var git_rev = require('git-rev');
var prompt = require('prompt');
var config = require('../config');
var logger = config.logger;
var manifest = config.manifest;

var promptForMissingOptions = function(options) {
	var deferred = Q.defer();

	git_state.isGit(process.cwd(), function(isGit) {
		if (!isGit) {
			return deferred.resolve(options.deploymentTimestamp);
		}
		git_state.check(process.cwd(), function(err, check_result) {
			if (err) {
				return deferred.resolve(options.deploymentTimestamp);
			}
			require('git-rev').short(function (rev) {
				if (check_result.dirty || check_result.untracked) {
					return deferred.resolve([rev, options.deploymentTimestamp].join('_'));
				}
				return deferred.resolve(rev);
			});
		});
	});

	return deferred.promise.then(function(defaultTag) {
		prompt.override = options;
		prompt.start();

		prompt.message = '';
		prompt.delimiter = '';

		var promptedOptions = {
			properties: {
				tag: {
					description: 'Tag to call this deployment?',
					type: 'string',
					pattern: /^[\w]+[\w\.]*[\w]+$/,
					required: true,
					default: [defaultTag || 'latest', options.environment].join('.')
				}
			}
		};
		return Q.ninvoke(prompt, 'get', promptedOptions);
	})
	.then(function(promptedOptions) {
		return _.merge(options, promptedOptions);
	});
};

function loadOptionsFromFile(file, callback) {
	var filePath = path.resolve(file);
	fs.stat(filePath, function(err, stat) {
		if (err && err.code === 'ENOENT') {
			return callback(new Error('Could not find file: ' + filePath));
		}
		else if (err) {
			return callback(err);
		}
		var options = require(filePath);
		return callback(undefined, options);
	});
}

function appendOptionsFromFile(file) {
	return function(options) {
		return Q.nfcall(loadOptionsFromFile, file)
		.then(function(newOptions) {
			return _.merge(options, newOptions);
		});
	};
}

function setDefaultValues(options) {
	_.each(options.jobs, function(jobInfo, jobName) {
		if(!_.has(jobInfo, 'cluster')) {
			_.set(options, ['jobs', jobName, 'cluster'], options.aws.defaultECSCluster);
		}
	});

	_.each(options.services, function(serviceInfo, serviceName) {
		if(!_.has(serviceInfo, 'cluster')) {
			_.set(options, ['services', serviceName, 'cluster'], options.aws.defaultECSCluster);
		}
		_.set(options, ['services', serviceName, 'name'], serviceName);
	});
	return options;
}


function setup(userPromptedOptions) {

	userPromptedOptions = _.defaultTo(userPromptedOptions, _.identity);

	/**
	 * Sets up build/deployment options based on passed in runtime options and any discovered
	 * Manifest and environment files. Will also prompt user to enter any missing required
	 * options for DeploymentOptions.
	 * @private
	 * @function setup
	 * @param {object} runtimeOptions - options passed in through the command line
	 * @param {string} runtimeOptions.file - [Optional] relative or absolute path to manifest file. Defaults to deployment/Manifest.js.
	 * @param {string} runtimeOptions.environment - <Required> name of environment for this deployment. Must have a matching file located at /path/to/manifest/env/{environment}.js
	 * @return {Promise.<DeploymentOptions>} promise resolving to the merged DeploymentOptions with the following order of preference RuntimeOptions > Environment File > Manifest File > User Prompted
	 */
	return function(runtimeOptions) {
		// Load specified Manifest file or default in [cwd]/deployment/Manifest.js
		runtimeOptions.file = path.resolve(runtimeOptions.file || 'deployment/Manifest.js');
		var manifestFileDirectory = path.dirname(runtimeOptions.file);
		// Load Environment Specific Variables
		runtimeOptions.environmentFile = path.join(manifestFileDirectory, 'env', runtimeOptions.environment+'.js');

		return Q.when({ deploymentTimestamp: Date.now() })
		.then(appendOptionsFromFile(runtimeOptions.file))
		.then(appendOptionsFromFile(runtimeOptions.environmentFile))
		.then(function(options) {
			return _.merge(options, runtimeOptions);
		})
		.then(function(options) {
			_.each(options.images, function(imageInfo, imageId) {
				var relativePath = _.get(options, ['images', imageId, 'dockerBuildContext'], '..');
				var absolutePath = path.resolve(path.join(manifestFileDirectory, relativePath));
				_.set(options, ['images', imageId, 'dockerBuildContext'], absolutePath);
			});
			return options;
		})
		.then(setDefaultValues)
		.then(userPromptedOptions);
	};
}

/**
 * Lints the provided DeploymentOptions to ensure required information is provided in Manifest and Environment files.
 * Lint errors will be printed to logger as error messages.
 * @param {DeploymentOptions} options - combination of runtime options, user provided options, manifest and environment specific options for this deployment task.
 * @return {Promise.<DeploymentOptions>} - Returns a promise resolving to the passed in options or rejecting with error if lint fails.
 */
function lint(options) {
	logger.info('linting manifest and environment files');
	var errors = manifest.lint(options);
	_.each(errors, function(error) {
		var property = _.replace(error.property, /^instance./,'');
		logger.error(property, error.message);
	});
	if (!_.isEmpty(errors)) {
		return Q.reject(new Error('lint failed. Please check manifest and environment files.'));
	}
	logger.info('lint passed');
	return Q.when(options);
}

module.exports = {
	setup: setup,
	lint: lint,
	promptForMissingOptions: promptForMissingOptions
};
