'use strict';

/**
 * @module SecretTasks
 */

var Q = require('q');
var _ = require('lodash');
var logger = require('winston');
var Credstash = require('nodecredstash');
var yaddaSecret = require('@asymmetrik/yadda-secret');

var IAM = require('./iam-tools');

/**
 * Generate Credstash credential store
 * @param {object} options - user provided options for the credential store
 * @param {object} options.DeploymentCenter - user provided options for the deployment center
 * @param {string} options.DeploymentCenter.name - Deployment center name
 * @param {string} options.DeploymentCenter.region - Deployment center region
 * @param {object} options.DeploymentCenter.secret - Secret options
 * @param {string} options.DeploymentCenter.secret.kmsKeyAlias - KMS Master Key Alias to encrypt/decrypt data
 * @param {string} options.DeploymentCenter.secret.region - If the KMS Master Key is in a different region
 * @return {module.exports|Credstash}
 */
function getCredentialStore(options){
	var tableDetails = getCredentialTableDetails(options);
	var store = new Credstash({
		table: tableDetails.name,
		awsOpts: { region: tableDetails.region },
		kmsOpts: { region: options.DeploymentCenter.secret.region || tableDetails.region },
		kmsKey: options.DeploymentCenter.secret.kmsKeyAlias,
	});
	store.__name = tableDetails.name;
	return store;
}

/**
 * Generate secret table name from deployment center
 * @param {string} options.DeploymentCenter.name - Deployment center name
 * @param {string} options.DeploymentCenter.region - Deployment center region
 * @return {{name: string, region: string}}
 */
function getCredentialTableDetails(options){
	return {
		name: options.DeploymentCenter.name+'-Secrets',
		region: options.DeploymentCenter.region,
	}
}

/**
 * Creates SecretCenter table in DynamoDB
 * @param {object} options - user provided options
 */
exports.createSecretCenter = function(options){
	return Q.when(options)
		.then(function(){
			logger.info('Creating DeploymentCenter Secret Center');
			var store = options.DeploymentCenter.secret.secretStore();

			return store.createDdbTable()
				.then(function(){
					logger.info(store.__name+' was created successfully');
					return options;
				});
		});
};

/**
 * Create SecretCenter IAM policies
 * @param {object} options - user provided options
 */
exports.createSecretCenterPolicy = function(options){
	return Q.when(options)
		.then(function(){
			var storeDetails = getCredentialTableDetails(options);

			var iam = IAM(storeDetails.region);

			return Q.all([
				iam.dynamoDB.createReadOnlyRole(storeDetails.name)
					.then(function(role){ logger.info('ReadOnly Table Role created: `'+role.RoleName+'`'); }),

				iam.dynamoDB.createAdminRole(storeDetails.name)
					.then(function(role){ logger.info('Administration Table Role created: `'+role.RoleName+'`'); })
			])
				.then(function(){
					return options;
				});
		})
};

/**
 * Cache bust secrets
 * @param {object} options - user provided options
 * @param {object} options.DeploymentCenter.secret - Secret Center options
 * @param {function} options.DeploymentCenter.secret._prefixKey - Secret key prefixer
 * @param {string} options.DeploymentCenter.secret.cacheBusterKey - Secret key to use for cache busting
 * @return {Q.Promise}
 */
exports.refreshSecrets = function(options) {
	return Q.when(options)
		.then(function(){
			var secrets = options.DeploymentCenter.secret;
			var store = secrets.secretStore();

			if(!secrets.cacheBusterKey){
				return logger.warn('no cache buster key set');
			}

			var opts = {
				name: secrets._prefixKey(secrets.cacheBusterKey),
				secret: Date.now()
			};
			return store.incrementVersion(opts).then(function(version){
				opts.version = version;
				return store.putSecret(opts);
			})
				.then(function(){
					logger.info('Successfully refreshed secrets');
				});
		});
};

/**
 * Retrieve secret from credential store
 * @param {object} options - user provided options
 * @param {object} options.DeploymentCenter.secret - Secret Center options
 * @param {function} options.DeploymentCenter.secret._prefixKey - Secret key prefixer
 * @param {object} options.secretParams - Secret parameters
 * @param {string} options.secretParams.secret - Secret to retrieve from store
 * @param {string} options.secretParams.version - (Optional) specify which version you want to retrieve. Defaults to the latest one. Will automatically handle padding of 0's
 * @param {object} options.secretParams.context - (Optional) KMS context
 * @return {Q.Promise}
 */
exports.getSecret = function(options){
	return Q.when(options)
		.then(function(){
			var secrets = options.DeploymentCenter.secret;
			var params = options.secretParams;
			var store = secrets.secretStore();

			return store.getSecret({
				name: secrets._prefixKey(params.secret),
				version: params.version ? _.padStart(params.version, 19, '0') : undefined,
				context: params.context,
			})
				.then(function(secrets){
					logger.warn(JSON.stringify(secrets, null, 2));
					return secrets;
				})
		});
};

/**
 * Put secret into credential store
 * @param {object} options - user provided options
 * @param {object} options.DeploymentCenter.secret - Secret Center options
 * @param {function} options.DeploymentCenter.secret._prefixKey - Secret key prefixer
 * @param {object} options.secretParams - Secret parameters
 * @param {string} options.secretParams.secret - Secret to encrypt into store
 * @param {string} options.secretParams.value - Secret value to encrypt into store
 * @param {string} options.secretParams.version - (Optional) specify which version you want to encrypt. Will default to the next available one. Will automatically handle padding of 0's
 * @param {object} options.secretParams.context - (Optional) KMS context
 * @return {Q.Promise}
 */
exports.putSecret = function(options){
	return Q.when(options)
		.then(function(){
			if(!options.secretParams.secret || !options.secretParams.value)
				throw new Error('You forgot to specify the value to set `'+options.secretParams.secret+'` to');
		})
		.then(function(){
			var secrets = options.DeploymentCenter.secret;
			var params = options.secretParams;
			var store = secrets.secretStore();

			var opts = {
				name: secrets._prefixKey(params.secret),
				secret: params.value,
				version: params.version ? _.padStart(params.version, 19, '0') : undefined,
				context: params.context,
			};

			return Q.when()
				.then(function(){
					if(opts.version === undefined){
						return store.incrementVersion(opts).then(function(version){
							opts.version = version;
						});
					}
				})
				.then(function(){
					return store.putSecret(opts);
				})
				.then(function(){
					logger.info('Secret `'+opts.name+'` successfully put in store');
				});
		});
};

/**
 * Delete secret from credential store
 * @param {object} options - user provided options
 * @param {object} options.DeploymentCenter.secret - Secret Center options
 * @param {function} options.DeploymentCenter.secret._prefixKey - Secret key prefixer
 * @param {object} options.secretParams - Secret parameters
 * @param {string} options.secretParams.secret - Secret to delete from store
 * @param {string} options.secretParams.version - (Optional) specify which version you want to delete. Defaults to the latest one. Will automatically handle padding of 0's
 * @return {Q.Promise}
 */
exports.deleteSecret = function(options){
	return Q.when(options)
		.then(function(){
			var secrets = options.DeploymentCenter.secret;
			var params = options.secretParams;
			var store = secrets.secretStore();

			var opts = {
				name: secrets._prefixKey(params.secret),
				version: params.version ? _.padStart(params.version, 19, '0') : undefined,
			};

			return Q.when()
				.then(function(){
					if(!opts.version){
						return store.getHighestVersion(opts).then(function(version) {
							opts.version = version;
						});
					}
				})
				.then(function(){
					return store.deleteSecret(opts);
				})
				.then(function(){
					logger.info('Secret `'+opts.name+'` (ver: '+Number.parseInt(opts.version)+') successfully deleted');
				})
		});
};

/**
 * Delete secret from credential store
 * @param {object} options - user provided options
 * @return {Q.Promise}
 */
exports.listSecrets = function(options){
	return Q.when(options)
		.then(function(){
			var store = options.DeploymentCenter.secret.secretStore();
			const secretPrefix = options.DeploymentCenter.secret._prefixKey('') + '/';
			return store.listSecrets()
				.then(function(list){
					const filteredList = {};
					_.each(list, function(secret){
						if(!_.startsWith(secret.name, secretPrefix))
							return;
						if(!filteredList[secret.name] || Number(filteredList[secret.name].version) < Number(secret.version))
							filteredList[secret.name] = secret;
					});

					if(Object.keys(filteredList).length === 0)
						logger.warn('There are no secrets you can see.');

					_.each(filteredList, _.unary(logger.info));

					return list;
				})
		});
};

/**
 * Verify that the secret center is configured
 * @param {object} options - User provided options
 * @param {object} options.DeploymentCenter - Deployment center configuration
 * @throws Error
 * @return options
 */
exports.verify = function(options){
	return Q.when(options)
		.then(function(){
			if(!('secret' in options.DeploymentCenter))
				throw new Error('Cannot manage secrets without Deployment Center `secret` configuration specified in environment');

			return options;
		})
};

/**
 * Sets up secret center parameters into options
 * @param {object} options - User provided options
 * @param {string} options.AppName - Application name and secret environment
 * @param {string} options.environment - Application environment
 * @param {string} options.aws.region - Application region
 * @param {object} options.DeploymentCenter.secret - Secret center configuration
 * @return options
 */
exports.setupSecretCenter = function(options){
	return Q.when(options)
		.then(function(){
			//Determine if secrets are enabled
			if(!options.DeploymentCenter.secret)
				return options;

			var _app = options.AppName;
			var env = options.environment;
			var region = options.aws.region;

			options.DeploymentCenter.secret._prefixKey = function(name) {
				try {
					return yaddaSecret.generateSecretKey({
						app: _app,
						env: env,
						region: region,
						name: name
					});
				}catch(e){
					console.error(e);
					throw e;
				}
			};

			options.DeploymentCenter.secret.secretStore = function(){ return getCredentialStore(options) };

			// check to see if we need to create an initial timestamp for the cache busting
			if(!options.DeploymentCenter.secret.cacheBusterKey)
				return options;

			return options.DeploymentCenter.secret.secretStore().getSecret({
				name: options.DeploymentCenter.secret._prefixKey(options.DeploymentCenter.secret.cacheBusterKey)
			})
				.catch(function(err){
					return exports.refreshSecrets();
				})
				.then(function(){
					return options;
				});
		});
};

exports.populateYaddaSecretEnvironment = function(options){
	return Q.when(options)
		.then(exports.getEnvironmentVariables)
		.then(function(vars){
			return _.merge(vars, options);
		});
};

exports.getEnvironmentVariables = function(options){
	var tableDetails = getCredentialTableDetails(options);
	return {
		'__YADDA__DEPLOYMENT_SECRET_TABLE__': tableDetails.name,
		'__YADDA__DEPLOYMENT_SECRET_TABLE_REGION__': tableDetails.region,
		'__YADDA__DEPLOYMENT_SECRET_PREFIX__': options.DeploymentCenter.secret._prefixKey(''),
		'__YADDA__DEPLOYMENT_SECRET_KMSALIAS__': options.DeploymentCenter.secret.kmsKeyAlias,
		'__YADDA__DEPLOYMENT_SECRET_REGION__': options.DeploymentCenter.secret.region || tableDetails.region,
		'__YADDA__DEPLOYMENT_SECRET_CACHE_BUSTER_KEY__': options.DeploymentCenter.secret.cacheBusterKey
	};
};
