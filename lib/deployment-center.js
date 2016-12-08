'use strict';

var Q = require('q');
var AWS = require('aws-sdk');
var _ = require('lodash');

var DEPLOYMENT_STATUS_INDEX_NAME = 'DeploymentStatus';

/**
 * Manages Deployment History and Current Deployment Status of Services and Jobs
 * @module DeploymentCenter
 */

/**
 * DeployableTaskItem
 * @typedef {object} module:DeploymentCenter~DeploymentCenter~DeployableTaskItem
 * @property {string} taskId - Service Name or Job Name from Manifest files.
 * @property {string} taskDefinitionArn - ARN for the Task Definition associated with this deployment.
 * @property {string} ecsCluster - Short name for ECS Cluster this deploy item runs on.
 * @property {string} ecsRegion - Region for the ECS Cluster.
 * @property {string} schedule - Cron Schedule to run this deployed item on, if any.
 * @property {string} taskType - Whether this is a service or job
 */

/**
 * Information representing a prior deployment in the Deployment History Table.
 * @typedef {object} module:DeploymentCenter~DeploymentCenter~Deployment
 * @property {string} appName - Name for the Application Stack (collection of services and jobs)
 * @property {number} deploymentTimestamp - Unix time when this item was deployed.
 * @property {string} environment - Environment this deployment occured on.
 * @property {boolean} active - Whether this item is currently deployed.
 * @property {Array.<module:DeploymentCenter~DeploymentCenter~DeployableTaskItem>} tasks
 * @property {object} parentDeployment - previous deployment active when this deployment occured.
 * @property {object} parentDeployment.appName - parent deployment's appName
 * @property {object} parentDeployment.deploymentTimestamp - parent deployment's deploymentTimestamp
 */

/**
 * Creates an unconfigured Deployment Center. Must call setup prior to using the new center.
 * @class Manages Depoyment History and Current Deployment Status.
 */
var DeploymentCenter = module.exports = function() {
};

/**
 * Setups the Deployment Center. Will create a DynamoDB table for storing Deployment History, if the table does not already exists.
 * Also creats a AWS Lambda with associated CloudwatchEvent alarm that runs the Jobs on the cron schedule (Lambda will be called every mintue).
 * @param {string} region - AWS Region to create DeploymentCenter items
 * @param {string} deploymentCenterName - Unique name for this deployment center (Must be unique within the region). This will be used as the Deployment History Table name.
 * @return {Promise} Promise resolving if setup is successful or rejecting on error.
 */
DeploymentCenter.prototype.setup = function(region, deploymentCenterName) {

	var cloudFormation = new AWS.CloudFormation({
		region: region
	});

	this.dynamoDBDocumentClient = new AWS.DynamoDB.DocumentClient({
		region: region
	});

	this.region = region;

	var self = this;

	return Q.ninvoke(cloudFormation, 'describeStacks', {
		StackName: deploymentCenterName
	}).then(function(stacksData) {
		var outputs = _.find(stacksData.Stacks, {StackName: deploymentCenterName}).Outputs;
		self.deploymentTableName = _.find(outputs, {OutputKey: 'DeploymentHistoryTableName'}).OutputValue;
	});

};

/**
 * Get Current Deployment for the given app in the given environment
 * @param {string} appName - App Name
 * @param {string} environment - Environment
 * @return {Promise.<module:DeploymentCenter~DeploymentCenter~Deployment>} Promise resolving the the currently deployed version of the app, or rejecting on error.
 */
DeploymentCenter.prototype.getCurrentDeployedVersion = function(appName, environment) {
	var params = {
		TableName: this.deploymentTableName,
		IndexName: DEPLOYMENT_STATUS_INDEX_NAME,
		KeyConditionExpression: 'appName = :appName AND active = :active',
		FilterExpression: 'environment = :environment',
		ExpressionAttributeValues: {
			':appName': appName,
			':active': 1,
			':environment': environment
		}
	};
	return Q.ninvoke(this.dynamoDBDocumentClient, 'query', params)
	.then(function(results) {
		return _.head(results.Items);
	});
};

/**
 * Retreive Deployment Information
 * @param {object} deployment
 * @param {string} deployment.appName - App Name
 * @param {number} deployment.deploymentTimestamp - Unix Timestamp identifying the deployment
 * @return {Promise.<module:DeploymentCenter~DeploymentCenter~Deployment>} deployment information
 */
DeploymentCenter.prototype.get = function(deployment) {

	if(!deployment) {
		return Q.when();
	}

	var params = {
		TableName: this.deploymentTableName,
		Key: {
			appName: deployment.appName,
			deploymentTimestamp: deployment.deploymentTimestamp
		}
	};

	return Q.ninvoke(this.dynamoDBDocumentClient, 'get', params)
	.then(function(result) {
		return result.Item;
	});
};

/**
 * Set active value for deployment
 * @param {object} deployment
 * @param {string} deployment.appName - App Name
 * @param {number} deployment.deploymentTimestamp - Unix Timestamp identifying the deployment
 * @param {boolean} active - New active status
 * @return {Promise.<object>} Promise resolving if deployment is changed, or rejecting on error.
 */
DeploymentCenter.prototype.setActiveStatusForDeployment = function(deployment, active) {
	var params = {
		TableName: this.deploymentTableName,
		Key: {
			appName: deployment.appName,
			deploymentTimestamp: deployment.deploymentTimestamp
		},
		UpdateExpression: 'SET active = :active',
		ExpressionAttributeValues: {
			':active': active ? 1 : 0
		}
	};
	return Q.ninvoke(this.dynamoDBDocumentClient, 'update', params)
	.then(function() {
		deployment.active = active ? 1 : 0;
		return deployment;
	});
};

/**
 * Mark provided items as currently deployed
 * @param  {module:DeploymentCenter~DeploymentCenter~Deployment} deployment - deployment to mark as deployed
 * @return {Promise} Promise resolving if statuses are updated, or rejecting on any error.
 */
DeploymentCenter.prototype.finalizeDeployment = function(deployment) {
	var self = this;
	var deploymentTimestamp = deployment.deploymentInformation.deploymentTimestamp;

	var withdrawParent;

	if (deployment.parentDeployment) {
		withdrawParent = self.setActiveStatusForDeployment(deployment.parentDeployment, false);
	} else {
		withdrawParent = Q.when();
	}

	return withdrawParent.then(function() {
		deployment.deploymentTimestamp = deploymentTimestamp;
		deployment.active = 1;

		var params = {
			TableName: self.deploymentTableName,
			Item: deployment
		};

		return Q.ninvoke(self.dynamoDBDocumentClient, 'put', params)
		.thenResolve(deployment);
	});
};
