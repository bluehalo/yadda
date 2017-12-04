'use strict';

var Validator = require('jsonschema').Validator;
var v = new Validator();

/**
 * @namespace Manifest
 * @property {string} AppName - name of application stack (must be unique to deployment center)
 * @property {Manifest.DeploymentCenter} DeploymentCenter - Reusable deployment center settings across environments.
 * @property {Manifest.AWSSettings} aws - environment specific settings for aws.
 * @property {object.<string,Manifest.ImageTemplate>} images - Dictionary of images to build and push to ECR. Keys provided here can be referenced in TaskTemplates as the image to use the built image for the TaskTemplate.
 * @property {object.<string,Manifest.ServiceTemplate>} services - Dictionary of services to deploy to ECS. Keys are the service names and must be unique to the Deployment Center (and ECS).
 * @property {object.<string,Manifest.JobTemplate>} jobs - Dictionary of jobs to run on schedule in ECS. Keys are the job names and must be unique to the Deployment Center.
 */
var ManifestSchema = {
	id: '/Manifest',
	type: 'object',
	properties: {
		AppName: { type: 'string' },
		DeploymentCenter: { '$ref': '/DeploymentCenter' },
		aws: { '$ref': '/AWSSettings' },
		images: {
			type: 'object',
			patternProperties: {
				'^[\\w-]+$': { '$ref': '/ImageTemplate' }
			},
			additionalProperties: false
		},
		services: {
			type: 'object',
			patternProperties: {
				'^[\\w-]+$': { '$ref': '/ServiceTemplate' }
			},
			additionalProperties: false
		},
		jobs: {
			type: 'object',
			patternProperties: {
				'^[\\w-]+$': { '$ref': '/JobTemplate' }
			},
			additionalProperties: false
		}
	},
	required: ['AppName', 'DeploymentCenter', 'aws', 'images']
};

/**
 * Deployment Center Settings. Can be reused across environments for a shared deployment history.
 * @typedef {object} DeploymentCenter
 * @memberof Manifest
 * @property {string} name - name of deployment center to use or create. Must be unique within the deployment centers region.
 * @property {string} region - AWS Region to deployed this deployment center. Does not need to be the environment's region.
 */
var DeploymentCenterSchema = {
	id: '/DeploymentCenter',
	type: 'object',
	properties: {
		name: { type: 'string' },
		region: { type: 'string' },
		secret: { '$ref': '/SecretSettings' },

	},
	required: ['name', 'region'],
	additionalProperties: false
};
v.addSchema(DeploymentCenterSchema);

/**
 * Secret Settings.
 * @typedef {object} SecretSettings
 * @memberof Manifest
 * @property {string} kmsKeyAlias - The key alias to use. Must be unique within the deployment centers region.
 * @property {string} region - AWS Region the key alias resides in. Does not need to be the environment's region.
 * @property {string} cacheBusterKey - The secret key used for cache busting.
 */
var SecretSettingsSchema = {
	id: '/SecretSettings',
	type: 'object',
	properties: {
		kmsKeyAlias: { type: 'string' },
		region: { type: 'string' },
		cacheBusterKey: { type: 'string' }
	},
	required: ['kmsKeyAlias'],
	additionalProperties: false
};
v.addSchema(SecretSettingsSchema);

/**
 * Environment specific settings for AWS.
 * @typedef {object} AWSSettings
 * @memberof Manifest
 * @property {string} region - Region for ECR and for provided ECS clusters
 * @property {string} defaultECSCluster - Short name for ECS Cluster to use for Services and Jobs in this environment
 */
var AWSSettingsSchema = {
	id: '/AWSSettings',
	type: 'object',
	properties: {
		region: { type: 'string' },
		defaultECSCluster: { type: 'string' }
	},
	required: ['region', 'defaultECSCluster'],
	additionalProperties: false
};
v.addSchema(AWSSettingsSchema);

/**
 * Build Information for Docker images
 * @typedef {object} ImageTemplate
 * @memberof Manifest
 * @property {string} repo - Name for repo in ECR (with optional namespace). If repo does not exists in a target regions ECR, it will be created on the first build.
 * @property {string} dockerBuildContext - path to docker build context for this image, relative to the manifest file.
 * @property {string} dockerfile - path to Dockerfile for build, relative to dockerBuildContext
 */
var ImageTemplateSchema = {
	id: '/ImageTemplate',
	type: 'object',
	properties: {
		repo: { type: 'string' },
		dockerBuildContext: { type: 'string' },
		dockerfile: { type: 'string' }
	},
	additionalProperties: false
};
v.addSchema(ImageTemplateSchema);

/**
 * Information defining a service in ECS. (Services are intended for tasks that should always be running)
 * @typedef {object} ServiceTemplate
 * @memberof Manifest
 * @property {string} serviceRole - ARN for a ECS Service Role. Required if service will be attached to load balancer.
 * @property {number} initialCount - Number of containers to start for this service when the service is first created. Has no impact on existing services.
 * @property {Array.<object>} loadBalancers - Optional information for connecting Service to a load balancer. If provided, must be provided to a new service, not an existing service. For settings, see AWS Task Definition Documentation on the LoadBalancers property.
 * @property {Manifest.TaskTemplate} taskTemplate - Task Template for creating Task Definitions for this service
 */
var ServiceTemplateSchema = {
	id: '/ServiceTemplate',
	type: 'object',
	properties: {
		serviceRole: { type: 'string' },
		initialCount: { type: 'number' },
		loadBalancers: {
			type: 'array',
			items: { type: 'object' }
		},
		taskTemplate: { '$ref': '/TaskTemplate'}
	},
	required: ['initialCount', 'taskTemplate']
};
v.addSchema(ServiceTemplateSchema);

/**
 * Information defining a scheduled job to run in ECS. (Jobs are tasks that run on a regular schedule defined by a cron statement)
 * @typedef {object} JobTemplate
 * @memberof Manifest
 * @property {string} schedule - A valid cron string defining when the job should run (time is in UTC)
 * @property {string} runOnDeploy - Set if you want to run the job after the deployment is complete. This will not run after a rollback. 'before' will run before the services are stable, 'after' will run after the services are stable.
 * @property {Manifest.TaskTemplate} taskTemplate - Task Template for creating Task Definitions for this job.
 */
var JobTemplateSchema = {
	id: '/JobTemplate',
	type: 'object',
	properties: {
		schedule: { type: 'string' },
		runOnDeploy: {
			enum: [ 'before', 'after' ]
		},
		taskTemplate: { '$ref': '/TaskTemplate' }
	},
	required: ['taskTemplate']
};
v.addSchema(JobTemplateSchema);

/**
 * Defines how to create a Task Definition for use on ECS for Services and Jobs. In addition to the properties below, any valid property defined in the Container Definintions for AWS Task Definitions is valid.
 * @typedef {object} TaskTemplate
 * @memberof Manifest
 * @property {string} taskRoleArn - ARN for optional container TaskRole to assign this task definition
 * @property {string} image - Either a string matching the key provided for an image in the Manifest.images or any valid Docker image setting as defeined in the AWS ECS Task Definition spec.
 * @property {object} environment -  Acts the same as the environment property in ECS Task Definition Containers spec, but allows use of JSON key-value pairing in place of using { "key": "key", "value": "value"} from the AWS spec. (AWS spec also works)
 */
var TaskTemplateSchema = {
	id: '/TaskTemplate',
	type: 'object',
	properties: {
		taskRoleArn: { type: 'taskRoleArn' },
		image: { type: 'string' },
		environment: {
			oneOf: [
				{ type: 'object' },
				{ type: 'array', items: { type: 'object' } }
			]
		}
	},
	required: ['image']
};
v.addSchema(TaskTemplateSchema);

/**
 * @module Manifest
 */

/**
 * Lint manifest object and returns whether the option complies with the required format for Manifest
 * @param {Manifest} manifest - manifest to lint
 * @return {Array} Array of validation errors
 */
exports.lint = function(manifest) {
	return v.validate(manifest, ManifestSchema).errors;
};
