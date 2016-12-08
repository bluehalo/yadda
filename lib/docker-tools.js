'use strict';

var Q = require('q');
var fs = require('fs');
var Docker = require('dockerode');
var docker = new Docker();
var tar = require('tar-fs');
var split = require('split');
var _ = require('lodash');
var logger = require('winston');
var path = require('path');
var ignore = require('ignore');

/**
 * DockerTools
 * @module DockerTools
 */

/**
 * Checks whether the provided filepath exists
 * @private
 * @param {string} path - file path
 * @return {promise} - Resolves if path exists, rejects if path does not exist or there is an IO error.
 */
function ensurePathExists(path) {
	return Q.nfcall(fs.stat, path)
		.thenResolve(path)
		.catch(function (err) {
			if (err && err.code === 'ENOENT') {
				err = new Error('build path does not exists');
			}
			return Q.reject(err);
		});
}

/**
 * Creates a tar packed stream of the build context at the provided build path.
 *
 * If a .dockerignore file is found at the build context's root, the .dockerignore
 * file is processed to remove matching files from the build context stream.
 * @private
 * @param {string} buildPath - path for build context
 * @return {stream} - stream of tar-packed build context
 */
function createBuildContextStream(buildPath) {

	logger.info('Packing Build Context (this can take a while)');

	var deferred = Q.defer();
	var dockerIgnore = path.join(buildPath, '.dockerignore');
	Q.nfcall(fs.readFile, dockerIgnore, 'utf8')
		.catch(function (err) {
			// If .dockerignore does not exists, then return tar packed stream of build context root.
			if (err && err.code === 'ENOENT') {
				return deferred.resolve(tar.pack(buildPath));
			}
			else {
				return deferred.reject(err);
			}
		})
		.then(function (contents) {
			// If .dockerignore does exists, then process file and ignore matching
			// files when creating tar stream.
			var ignorePatterns =  _(contents)
				// Split by lines
				.split(/\r?\n/)
				// Remove comment lines
				.map(_.curry(_.replace, 3)(_,/#.*/,''))
				// Remove empty lines
				.filter('length')
				.value();

			var filter = _.negate(ignore().add(ignorePatterns).createFilter());

			var tarStream = tar.pack(buildPath, {
				ignore: function(name) {
					name = path.relative(buildPath, name);
					return filter(name);
				}
			});
			deferred.resolve(tarStream);
		})
		.nodeify(deferred.makeNodeResolver());

	return deferred.promise;
}

/**
 * Creates docker image
 * @private
 * @param {stream} buildContextStream - tar packed stream of docker build context
 * @param {object} buildOptions - accepts valid build options documented in Docker Remote API for locally installed docker. See {@link https://docs.docker.com/engine/reference/api/docker_remote_api/|Remote API} for the version of docker running locally for valid options.
 * @return {promise} - promise resolving to image id for new build.
 */
function buildFromStream(buildContextStream, buildOptions) {
	var deferred = Q.defer();
	docker.buildImage(buildContextStream, buildOptions, function(err, buildStream) {
			if(err) return deferred.reject(err);

			var buildSuccessfulRegex = /Successfully built ([A-Fa-f0-9]+)/;
			var imageId;
			buildStream.on('error', deferred.reject);

			buildStream.pipe(split(/\r\n/, JSON.parse, {trailing: false})).on('data', function(buildStatus) {
				if (buildStatus.stream) {
					var matches = buildStatus.stream.match(buildSuccessfulRegex);
					if(matches) {
						imageId = matches[1];
					}
					logger.info(_.trimEnd(buildStatus.stream));
				}
				else if (buildStatus.error) {
					var err = new Error(buildStatus.error);
					return deferred.reject(err);
				}
			});
			buildStream.on('end', function() {
				deferred.resolve(imageId);
			});
	});
	return deferred.promise;
}

/**
 * Callback for building docker image.
 *
 * @callback dockerBuildCallback
 * @param {Error} err - error occurying during build
 * @param {string} ImageId - image id in local docker registry
 */

/**
 * Builds Docker image.
 * @param {string} dockerBuildPath - Path for build context for this build.
 * @param {string} t - repo and option tag for this build (using the Docker repo:tag format)
 * @param {string} dockerfile - path to dockerfile controlling this build (relative to build context root).
 * @param {dockerBuildCallback} callback - node style callback for build status
 * @return {promise} - promise with build status
 */
exports.build = function(dockerBuildPath, t, dockerfile, callback) {

	var deferred = Q.defer();

	var buildOptions = {
		t: t,
		dockerfile: dockerfile
	};

	Q.when(dockerBuildPath)
		.then(ensurePathExists)
		.then(createBuildContextStream)
		.then(function(buildContextStream) {
			return buildFromStream(buildContextStream, buildOptions);
		})
		.catch(function(err) {
			if (callback) {
				return callback(err);
			}
			return deferred.reject(err);
		})
		.done(function(imageId) {
			if (callback) {
				return callback(undefined, imageId);
			}
			return deferred.resolve(imageId);
		});

		return deferred.promise;
};

/**
 * Creates a proccessor function that consumes the docker stream.
 * @param {Function} callback - called when an error occurs, passing in the Error object, or when consumption stream is completed.
 * @return {DockerTools~StreamProcessor} processor
 */
function getStreamProcessor(callback) {
	/**
	 * Stream Processor
	 * @callback DockerTools~StreamProcessor
	 * @param {Error} err - error creating stream
	 * @param {stream} stream - stream to consume
	 */
	return function (err, stream) {
		if (err) return callback(err);

		stream.on('error', function(err) {
			return callback(err);
		});

		stream.pipe(split(/\r\n/, JSON.parse, {trailing: false})).on('data', function(status) {
			if (status.error) {
				var err = new Error(status.error);
				return callback(err);
			}
		});

		stream.on('end', function() {
			return callback(undefined);
		});
	};
}

/**
 * Callback for pushing docker image.
 *
 * @callback dockerPushCallback
 * @param {Error} err - error occurying during push
 */

/**
 * Push image to remote docker repo specified in repo name.
 * @param {object} authInformation - authentication for remote repo (if needed). See Docker Remote API documentation for valid values.
 * @param {string} t - repo name and tag in repo:tag format. Must include remote registry url in front of repo name
 * @param {dockerPushCallback} callback - node style callback returning errors that occur during push
 * @return {promise} - promise resolving to undefined if push is successful, rejecting if error
 */
exports.pushImage = function(authInformation, t, callback) {
	var deferred = Q.defer();

	var promiseAndCallback = function(err) {
		if (err) {
			deferred.reject(err);
		} else {
			deferred.resolve();
		}
		return callback(err);
	};

	docker.getImage(t).push({authconfig: authInformation}, getStreamProcessor(promiseAndCallback));
	return deferred.promise;
};

/**
 * Callback for pulling docker image.
 *
 * @callback dockerPullCallback
 * @param {Error} err - error occurying during pull
 */

/**
 * Pull image to remote docker repo specified in repo name.
 * @param {object} authInformation - authentication for remote repo (if needed). See Docker Remote API documentation for valid values.
 * @param {string} t - repo name and tag in repo:tag format. Must include remote registry url in front of repo name
 * @param {dockerPushCallback} callback - node style callback returning errors that occur during pull
 * @return {promise} - promise resolving to undefined if pull is successful, rejecting if error
 */
exports.pullImage = function(authInformation, t, callback) {
	var deferred = Q.defer();

	var promiseAndCallback = function(err) {
		if (err) {
			deferred.reject(err);
		} else {
			deferred.resolve();
		}
		return callback(err);
	};

	docker.pull(t, {authconfig: authInformation}, getStreamProcessor(promiseAndCallback));
	return deferred.promise;
};
