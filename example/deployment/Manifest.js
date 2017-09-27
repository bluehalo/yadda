'use strict';

module.exports = {

	AppName: 'MyApp',

	// Deployment Center Information created with the create-deployment-center command
	DeploymentCenter: {
		name: 'YaddaDeploymentCenter',
		region: 'us-east-1',

		//Optional, handling secret center
		secret: {
			enabled: true
		},
	},

	// Images to Be Built and Pushed to ECR
	images: {
		// Name internal image reference for other parts to hook onto.
		'my-custom-image': {
			// Repo Name will be namespaced by AppName and Environment
			repo: 'hello-world',
			// Path relative to Manifest file to use as Docker Build Context Root
			dockerBuildContext: '../hello-world',
			// Path to Dockerfile relative to Build Context (must be a descendent
			// file in the Build Context)
			dockerfile: 'Dockerfile'
		}
	},

	services: {

		// Multiple Services are supported, but only one is shown below

		// Name of Service to use on ECS
		'hello-world-server': {

			/*
			// Optional Service Role. Required if the Service needs to attach to a
			// load balancer
			serviceRole: 'arn:aws:iam::1234567890:role/myECSServiceRole',
			*/

			// Initial Count of Tasks to create for this Service
			initialCount: 1,

			// Task Definition Template. Modified version of AWS Task Definition
			// format. Follows the format for containers within the Task Definition.
			taskTemplate: {

				/*
				// Optional Container Task Role, if container needs any additional
				// permissions
				taskRoleArn: 'arn:aws:iam::1234567890:role/myContainerTaskRole',
				 */

				// Can reference either the internal image reference defined in images
				// to use the build image, or any valid image for ECS Task Definition.
				image: 'my-custom-image',

				// Rest are any valid options for containers in AWS Task Definitions.
				name: 'hello-world',
				memoryReservation: 128,
				cpu: 256,
				portMappings: [{
					containerPort: 3000,
					hostPort: 0,
					protocol: 'tcp'
				}],
				// Evironment can be in the AWS [{ key: 'key', value: 'value'}] format or in regular key:value pairs (as shown below);
				environment: {
					CUSTOM_MESSAGE: 'Welcome to Yadda'
				}
			}
		}
	},

	jobs: {

		// Multiple Jobs are also supported

		'docker-hello-world-job': {
			// Use Cron format to specify when job should run.
			// E.g., '*/5 * * * *' is every 5 minutes
			// Time is in UTC
			schedule: '*/5 * * * * *',

			// Task Definition Template. Modified version of AWS Task Definition
			// format. Follows the format for containers within the Task Definition.
			taskTemplate: {

				/*
				// Optional Container Task Role, if container needs any additional
				// permissions
				taskRoleArn: 'arn:aws:iam::1234567890:role/myOtherContainerTaskRole',
				*/

				// If provided image does not match a custom image defined above, then
				// will attempt to pull the image from Docker hub
				image: 'hello-world',
				name: 'docker-hello',
				memoryReservation: 128
				/*
				// Environment variables are supported here too.

				environment: {
					CUSTOM_ENV_VAR: 'some_value'
				},
				*/
			}
		}
	}
};
