'use strict';

var Q = require('q');
var logger = require('winston');
var storage = require('nodecredstash');

function putSecret(options){
    return Q.when(options)
        .then(function(){
            logger.info(options);
        });
}

function getSecret(options){
    return Q.when(options)
        .then(function(){
            console.log(options);
        });
}

var actions = {
    'put': putSecret,
    'get': getSecret,
};

exports.handleSecretTask = function(options){
    var action = options.action.toLowerCase();

    if(!(action in actions))
        throw new Error("`"+action+"` is not a defined action for secrets");

    return Q.when(options)
        .then(actions[action]);
};

exports.createSecretCenter = function(options){

    return Q.when(options);
};