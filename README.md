yadda
=====
(Yet Another Docker Deployment Application)

`yadda` is a command line tool for managing deploying a collection of
microservices to AWS EC2 Container Service using a declarative syntax. Create a
Manifest file (and associated environment files) declaring your services and
jobs (one-time or periodic task), and `yadda` will handle building the required
docker images, pushing them to your AWS Elastic Container Registry, creating
the associated services and task definitions in ECS, and running periodic tasks
on a schedule.

**Warning: Use of yadda will result in creating resources in AWS for which you
bear the cost.**

Getting Started
================

Install
--------

`yadda` is installable via npm under the `asymmetrik` namespace.

	$ npm install -g @asymmetrik/yadda

Deployment Center
-----------------

To operate, `yadda` first must install a deployment center that handles the
deployment history of your application (enabling the `rollback` feature) and
is responsible for running the jobs defined in your Manifest files.

To create the deployment center, run the following after installing `yadda`

	$ yadda create-deployment-center --region <AWS_REGION> <DEPLOYMENT_CENTER_NAME>

replacing `<AWS_REGION>` with the region you want the deployment center
installed in and `<DEPLOYMENT_CENTER_NAME>` with the name you want to give this
deployment center.

A single deployment center can be used to manage deployments across multiple
AWS Regions (including managing deployments on ECS clusters outside of the
region where the Deployment Center is installed).

Additionally, a single deployment center can handle managing multiple different
applications.

Manifest Files
--------------

`yadda` needs certain information to manage the deployments. This information is
stored in a Manifest file for a given App and specific environment files for
each deployment environment.

`yadda` expects these files to be within the root directory of your App,
inside a folder named `deployment`. An example folder structure is provided
below.

	MyApp
	|- deployment
		|- Manifest.js
		|- env
			|- production.js
			|- staging.js
			|- dev.js

To create a skeleton for the required files, run

	$ yadda init

which will create the deployment folder and skeleton files in the current
working directory.

You can find an full example under the `example` directory in this
repo. The example files will show the required information for configuring your
application.

The schema for the Manifest files can be found under `/config/manifest.js`.

Deploying your application
--------------------------

After creating your Deployment Center and Manifest, you can deploy the
application via

	$ yadda deploy <environment>

replacing `<environment>` with the name of the environment you want to deploy to
(for example, `yadda deploy staging` to deploy to the environment defined in
`deployment/env/staging.js`).

Secret Management
--------------------------

After your Deployment Center is created you can optionally create a secret center 
which your containers can leverage for encrypted secrets. See 
[Yadda-Secret](https://github.com/asymmetrik/yadda-secret) for the server package.

To create the Secret Center you can run  

	$ yadda create-secret-center <env>
	
The command will create a secret center in the same region as your environments 
deployment center. You can then access the secrets with

	$ yadda secret <env> <action> <key> [value]