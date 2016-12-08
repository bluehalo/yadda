'use strict';

var _ = require('lodash');
var AWS = require('aws-sdk');

/**
 * AWS Tools.
 * @module AWSTools
 */

/**
 * @class Manages images remotely in ECR
 * @param {string} region - AWS Region for ECR
 */
var Registry = exports.Registry = function(region) {
	/** AWS Region */
	this.region = region;

	/** Underlaying ECR SDK used by this class. */
	this.ecr = new AWS.ECR({
		apiVersion: '2015-09-21',
		region: region
	});
};

/**
 * Create new repository in ECR.
 * @param {string} repo - name for repository, including any namespacing.
 * @param {module:AWSTools~Registry~repositoryCallback} callback - node style callback for creating new ECR repo.
 */
Registry.prototype.createRepository = function(repo, callback) {
	this.ecr.createRepository({repositoryName: repo}, function(err, response) {
		if (err) return callback(err);
		return callback(undefined, response.repository.repositoryUri);
	});
};

/**
 * Finds an existing ECR repo matching the provided repo name, or creates one if one is not found.
 * @param {string} repo - name for repository, including any namespacing.
 * @param {module:AWSTools~Registry~repositoryCallback} callback - node style callback for ECR repo.
 */
Registry.prototype.findOrCreateECRRepository = function (repo, callback) {
	var self = this;
	self.ecr.describeRepositories({repositoryNames: [repo]}, function(err, response) {
		if (err && err.code === 'RepositoryNotFoundException') {
			return self.createRepository(repo, callback);
		}
		else if (err) {
			return callback(err);
		}
		return callback(undefined, response.repositories[0].repositoryUri);
	});
};

/**
 * Callback for created ECR.
 * @callback module:AWSTools~Registry~repositoryCallback
 * @param {Error} err - error from ECR
 * @param {string} repositoryURI - uri for the repository
 */

 /**
  * Gets docker authentication information for ECR repo.
  * @param {module:AWSTools~Registry~authenticationCallback} callback - node style callback providing ECR authentication information
  */
Registry.prototype.getAuthorizationToken = function(callback) {
 	this.ecr.getAuthorizationToken(function(err, data) {
 		if (err) return callback(err, undefined);

 		var encodedAuthData = data.authorizationData[0].authorizationToken;
 		var decodedAuthData = new Buffer(encodedAuthData, 'base64').toString('utf8');
 		var authArray = _.split(decodedAuthData, ':', 2);
 		return callback(undefined, {
 			username: authArray[0],
 			password: authArray[1],
 			email: 'none'
 		});
 	});
};

/**
 * Callback for getting ECR authentication information
 * @callback module:AWSTools~Registry~authenticationCallback
 * @param {Error} err - error occuring while looking up authentication information
 * @param {object} authenticationInformation - ECR authentication information
 * @param {string} authenticationInformation.username - ECR username
 * @param {string} authenticationInformation.password - Temporary, perishable password for ECR.
 * @param {string} authenticationInformation.email - Value 'none'
 */

/**
 * @class Manages Service and Image updates with AWS Infrastructure.
 * @param {string} region - AWS Region to deploy services and jobs to.
 */
var ContainerService = exports.ContainerService = function(region) {
	/** AWS Region */
	this.region = region;

	/** AWS ECS	SDK */
	this.ecs = new AWS.ECS({
		apiVersion: '2014-11-13',
		region: region
	});
};

/**
 * Wait for the services to stabilized.
 * @param {object} params - Parameters for aws waitFor call
 * @param {string} params.cluster - The name of the cluster that hosts the services
 * @param {array} params.services - The names of the services to wait for
 * @param {module:AWSTools~ContainerService~waitForServicesStableCallback} callback - node style callback for after services are stable.
 */
ContainerService.prototype.waitForServicesStable = function(params, callback) {
	this.ecs.waitFor('servicesStable', params, callback);
};

/**
 * Change manifest task definition format to AWS format.
 * @private
 * @param {TaskDefinitionTemplate} taskDefinition - task definition in Manifest file format.
 * @return {object} - task definition in format expected by AWS SDK
 */
function transformTaskDefinition(taskDefinition) {

	var family = taskDefinition.family;

	if (_.isObject(taskDefinition.environment)) {
		taskDefinition.environment = _.map(taskDefinition.environment, function(value, key) {
			return {
				name: key,
				value: value
			};
		});
	}

	return {
		family: taskDefinition.family,
		taskRoleArn: taskDefinition.taskRoleArn,
		containerDefinitions: [ _.omit(taskDefinition, ['family', 'taskRoleArn'])]
	};
}

/**
 * Information about Task Definition on ECS.
 * @typedef {object} module:AWSTools~ContainerService~TaskInformation
 * @property {string} family - Task Definition family
 * @property {string} revision - Task Definition revision number
 * @property {string} taskDefinitionArn - Task Definition ARN
 * @property {string} region - AWS Region Task Definition is registered to.
 */

/**
 * Callback for registering task definition with AWS
 * @callback module:AWSTools~ContainerService~registerTaskDefinitionCallback
 * @param {Error} err - error registering task definition
 * @param {module:AWSTools~ContainerService~TaskInformation} taskInformation - information on new task definition
 */

/**
 * Registers new Task Defintion with ECS
 * @param {TaskDefinitionTemplate} taskDefinition - task definition in Manifest file format.
 * @param {module:AWSTools~ContainerService~registerTaskDefinitionCallback} callback - node style callback for registering task definition on ECS.
 */
ContainerService.prototype.registerTaskDefinition = function(taskDefinition, callback) {
	var self = this;
	var awsTaskDefinition = transformTaskDefinition(taskDefinition);
	self.ecs.registerTaskDefinition(awsTaskDefinition,function(err, data) {
		if (err) return callback(err);

		return callback(undefined, {
			family: data.taskDefinition.family,
			revision: data.taskDefinition.revision,
			taskDefinitionArn: data.taskDefinition.taskDefinitionArn,
			region: self.region
		});
	});
};

/**
 * Deregister Provided Task Definition
 * @param {string} taskDefinition - Task Definition (family:revision or ARN) to deregister.
 * @param {Function} callback - Node-style callback providing result of deregister command.
 */
ContainerService.prototype.deregisterTaskDefinition = function(taskDefinition, callback) {
	this.ecs.deregisterTaskDefinition({taskDefinition: taskDefinition}, callback);
};

/**
 * Callback for updating ECS Service
 * @callback module:AWSTools~ContainerService~updateServiceCallback
 * @param {Error} err - error updating ECS service
 * @param {object} ecsServiceInformation - information on the updated ECS service.
 */

/**
 * Update ECS Service to use task definition revision.
 * @param {module:DeploymentCenter~DeploymentCenter~DeployableTaskItem} serviceTask - Service Task Information
 * @param {module:AWSTools~ContainerService~updateServiceCallback} callback - node style callback for updating ECS service
 */
ContainerService.prototype.updateService = function(serviceTask, callback) {

	var params = {
		service: serviceTask.serviceName,
		cluster: serviceTask.ecsCluster,
		taskDefinition: serviceTask.taskDefinitionArn
	};
	this.ecs.updateService(params, callback);
};

/**
 * Callback for describing ECS Service
 * @callback module:AWSTools~ContainerService~describeServiceCallback
 * @param {Error} err - error describing ECS service
 * @param {object} ecsServiceInformation - information on the ECS service
 */

/**
 * Describe current ECS Service.
 * @param {module:DeploymentCenter~DeploymentCenter~DeployableTaskItem} serviceTask - service task infromation
 * @param  {module:AWSTools~ContainerService~describeServiceCallback} callback - node style callback for current ECS service
 */
ContainerService.prototype.describeService = function(serviceTask, callback) {
	var params = {
		services: [ serviceTask.serviceName ],
		cluster: serviceTask.ecsCluster
	};

	this.ecs.describeServices(params, function(err, response) {
		if (err) return callback(err);
		var serviceData = _.get(response, ['services', '0']);
		return callback(undefined, serviceData);
	});
};

/**
 * Callback for creating new ECS Service
 * @callback module:AWSTools~ContainerService~createServiceCallback
 * @param {Error} err - error creating ECS service
 * @param {object} ecsServiceInformation - information on new ECS Service
 */

/**
 * Create a new ECS Service
 * @param {module:DeploymentCenter~DeploymentCenter~DeployableTaskItem} serviceTask - Service Task Information
 * @param {ServiceDefinitionTemplate} serviceTemplate template for creating new Service
 * @param {module:AWSTools~ContainerService~createServiceCallback} callback - callback for creating ECS service
 */
ContainerService.prototype.createService = function(serviceTask, serviceTemplate, callback) {
	var params = {
		cluster: serviceTask.ecsCluster,
		serviceName: serviceTask.serviceName,
		taskDefinition: serviceTask.taskDefinitionArn,
		desiredCount: serviceTemplate.initialCount || 1,
		role: serviceTemplate.serviceRole,
		loadBalancers: serviceTemplate.loadBalancers
	};

	this.ecs.createService(params, callback);
};

/**
 * Runs Task Immediately
 * @param {module:DeploymentCenter~DeploymentCenter~DeployableTaskItem} task - Dictionary with parameters for running the task.
 * @param {Function} callback - Node style callback return an error or information on the task if task is scheduled.
 */
ContainerService.prototype.runTask = function(task, callback) {
	var params = {
		cluster: task.ecsCluster,
		taskDefinition: task.taskDefinitionArn
	};

	this.ecs.runTask(params, callback);
};

/**
 * Describe Task Definition Callback
 * @callback module:AWSTools~ContainerService~describeTaskDefinitionCallback
 * @param {Error} err - error describing task definition
 * @param {object} taskDefinition - Task Definition from AWS ECS SDK
 */

/**
 * Gets information about the provided ECS Task Definition
 * @param {string} taskDefinitionArn - ARN for the Task Definition
 * @param  {module:AWSTools~ContainerService~describeTaskDefinitionCallback} callback - callback for describing Task Definition
 */
ContainerService.prototype.describeTaskDefinition = function(taskDefinitionArn, callback) {
	this.ecs.describeTaskDefinition({ taskDefinition: taskDefinitionArn}, callback);
};

/**
 * Deletes the service represented by the passed in Service task.
 * @param {module:DeploymentCenter~DeploymentCenter~DeployableTaskItem} serviceTask - Service Task
 * @param {Function} callback - Node-style callback passing back error deleting service.
 */
ContainerService.prototype.deleteService = function(serviceTask, callback) {
	var self = this;
	var setServiceToZero = {
		cluster: serviceTask.ecsCluster,
		service: serviceTask.serviceName,
		desiredCount: 0
	};
	self.ecs.updateService(setServiceToZero, function(err, data) {
		if (err) return callback(new Error('Error Deleting Service ' + serviceTask.serviceName));
		var params = {
			cluster: serviceTask.ecsCluster,
			service: serviceTask.serviceName
		};
		self.ecs.deleteService(params, callback);
	});

};
