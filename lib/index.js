"use strict";

var _ = require('underscore');
var q = require('q');
var Backbone = require('backbone');

var urlMatcher = require('slyn-url-matcher-factory');
var util = require('slyn-util-helper');
var Binder = require('slyn-data-binder');

var pageManager = function(router, states) {
    this.router = router || {};
    this.states = states;
    this.currentState = null; // this will contain all the pageviews in that state as well
    this.previousState = null; // this should contain previousfragment
    this.isInitialized = false;
    this.clickedBack = false;

    this.stateHistory = [];
    this.nextState = null;
    this.rootEl = null;
    this.clickedBack = false;

    this.currentViews = {};
    this.loadedControllers = {};
    
     // look for controllers folder in the root of the app excluding files in the node_modules folder
    this.controllerContext = require.context("../../..", true, /^((?![\/|\\]node_modules[\/|\\]).)*([\/|\\]controllers[\/|\\])(\w|\-|\_|\\|\/)*(\-controller)\.js$/);

    // look for templates folder in the root of the app excluding files in node_modules folder
    this.templateContext = require.context("../../..", true, /^((?![\/|\\]node_modules[\/|\\]).)*([\/|\\]templates[\/|\\])(\w|\-|\_|\\|\/)*(\-template)\.(dust|jade)$/);

}

/**
 * Finds the common ancestor path between two states.
 *
 * @param {Object} first The first state.
 * @param {Object} second The second state.
 * @return {Array} Returns an array of state names in descending order, not including the root.
 */
pageManager.prototype.ancestors = function(first, second) {
    var path = [];

    for (var n in first.path) {
        if (first.path[n] !== second.path[n]) break;
        path.push(first.path[n]);
    }
    return path;
}

/**
 * Merges a set of parameters with all parameters inherited between the common parents of the
 * current state and a given destination state.
 *
 * @param {Object} currentParams The value of the current state parameters ($stateParams).
 * @param {Object} newParams The set of parameters which will be composited with inherited params.
 * @param {Object} $current Internal definition of object representing the current state.
 * @param {Object} $to Internal definition of object representing state to transition to.
 */
pageManager.prototype.inheritParams = function(currentParams, newParams, current, to) {
    var parents = this.ancestors(current, to),
        parentParams, inherited = {},
        inheritList = [];

    for (var i in parents) {
        if (!parents[i].params || !parents[i].params.length) continue;
        parentParams = parents[i].params;

        for (var j in parentParams) {
            if (arraySearch(inheritList, parentParams[j]) >= 0) continue;
            inheritList.push(parentParams[j]);
            inherited[parentParams[j]] = currentParams[parentParams[j]];
        }
    }
    return _.extend({}, inherited, newParams);
}

pageManager.prototype.goTo = function(stateName, options) {
    // lookup in states before navigating
    //return this.router.navigate();
    /*
        Find states in the states array mathcing the statename.
        After finding the state, map options.params with the the regex and build the url
        Then use navigateTo(url) to update url and call the controllers for that state
        if stateName is abastract thorw an error. Navigating to an abastract state is forbindden.
    */
    this.navigateTo("/");
}

pageManager.prototype.navigateTo = function(url, options) {
    var options = _.extend({
        trigger: true
    }, options);

    this.router.navigate(url, options);
}

// TODO refactor this
pageManager.prototype.resolveState = function(state, options) {
    var deferred = q.defer();
    
    require.ensure([], function() {
        // this syntax is weird but it works
        if (state.parent.name === "") {
            console.log(state.controller);
            var controller = this.controllerContext("./"+state.controller);
            var template = this.templateContext("./"+state.templateUrl);

            // at this point wrap el in a div with state.name
            var el = Backbone.$("<div>").attr('state', state.name);
            //el.addClass('container');

            // attach element to root
            //Backbone.$(this.rootEl).append(el);

            controller.load(el, template, options.params)
                .then(function(con) {
                    Binder.applyBinding(con.view, con);

                    //
                    deferred.resolve({
                        state: state,
                        uiView: null,
                        controller: con
                    });
                })
                .catch(function(error) {
                    console.log(error);

                    //
                    deferred.reject(error);
                });
        } else {
            var all = [];

            _.each(state.views, function(content, view) {
                var controller = this.controllerContext('./'+content.controller);
                var template = this.templateContext('./'+content.templateUrl);

                var ui = this.getUiView(view);

                // at this point wrap el in a div with state.name
                var wrapElt = Backbone.$("<div>").attr('state', state.name);
                
                var deferred = q.defer();

                var itemTemplate = null;

                var loadControllerPromise = null;

                if(Object.hasOwnProperty.call(content, 'infiniteList') && content.infiniteList){
                    itemTemplate = (content.infiniteList && content.itemTemplateUrl)? this.templateContext('./'+content.itemTemplateUrl) : this.templateContext('./');
                    
                    loadControllerPromise = controller.load(wrapElt, template, itemTemplate, options.params);
                }else{
                    loadControllerPromise = controller.load(wrapElt, template, options.params);
                }
                
                    loadControllerPromise.then(function(con) {
                        // apply binding at the end
                        Binder.applyBinding(con.view, con);

                        deferred.resolve({
                            state: state,
                            uiView: ui,
                            controller: con
                        });
                    }).catch(function(error) {
                        console.log(error);

                        deferred.reject(error);
                    });

                all.push(deferred.promise);

            }.bind(this));

            q.all(all)
                .then(function(resolved) {
                    deferred.resolve(resolved);
                }).catch(function(error) {
                    console.log(error);
                    deferred.reject(error);
                })
        }
    }.bind(this));

    return deferred.promise;
};

/**
 * Normalizes a set of values to string or `null`, filtering them by a list of keys.
 *
 * @param {Array} keys The list of keys to normalize/return.
 * @param {Object} values An object hash of values to normalize.
 * @return {Object} Returns an object hash of normalized string values.
 */
pageManager.prototype.normalize = function(keys, values) {
    var normalized = {};

    _.each(keys, function(name) {
        var value = values[name];
        normalized[name] = (value != null) ? String(value) : null;
    });
    return normalized;
}

pageManager.prototype.transitionTo = function(to, toParams, options) {
    var deferred = q.defer();

    toParams = toParams || {};

    options = _.extend({
        location: true,
        inherit: false,
        relative: null,
        notify: true,
        reload: false,
        $retry: false
    }, options || {});

    var from = this.currentState || {
        path: []
    };
    var fromPath = from.path || [];
    var fromParams = (this.currentState) ? this.currentState.queryParam : {};

    var toState = to;
    var toPath = to.path;

    // Normalize/filter parameters before we pass them to event handlers etc.
    //toParams = this.normalize(to.params, toParams || {});

    // Resolve locals for the remaining states, but don't update any global state just
    // yet -- if anything fails to resolve the current state needs to remain untouched.
    // We also set up an inheritance chain for the locals here. This allows the view directive
    // to quickly look up the correct definition fo r each view in the current state. Even
    // though we create the locals object itself outside resolveState(), it is initially
    // empty and gets filled asynchronously. We need to keep track of the promise for the
    // (fully resolved) current locals, and pass this down the chain.
    var output = [];

    for (var l = options.keep; l < toPath.length; l++) {
        var state = toPath[l];
        var resolvedState = this.resolveState(state, {
            params: toParams
        });

        output.push(resolvedState);
    }

    q.all(output)
        .then(function(resolved) {
            // go through the results and attach the content to the dom
            for (var i = 0; i < resolved.length; i++) {
                var res = resolved[i];

                if (Object.prototype.hasOwnProperty.call(res, 'state') && res.state.parent.name === "") {
                    Backbone.$(this.rootEl).append(res.controller.view.$el);
                    this.loadedControllers[res.state.name] = res.controller;
                } else {
                    // it has to be an array
                    var controllers = [];
                    var name = "";

                    _.each(res, function(out) {
                        name = out.state.name;

                        var domState = Backbone.$(this.rootEl).find("[state='" + out.uiView.state + "']");

                        // TODO
                        if (!domState)
                            console.log('Error appending dom elements');

                        var el = Backbone.$(domState).find("[ui-view='" + out.uiView.view + "']");

                        Backbone.$(el).append(out.controller.view.$el);
                        controllers.push(out.controller);
                    }.bind(this));

                    this.loadedControllers[name] = controllers;
                }

            }

            deferred.resolve('success');
        }.bind(this)).catch(function(error) {
            // TODO
            console.log(error);
            deferred.reject();
        });

    return deferred.promise;
};

pageManager.prototype.getUiView = function(view) {
    var comp = view.split('@');
    if (comp.length < 2)
        throw new Error("unconventional name for views make sure it follows this format : ui-view-name@state-name")

    return {
        view: comp[0],
        state: comp[1]
    }
};

pageManager.prototype.unloadPreviousState = function(keepIndex) {
    //remove all element in the page from all the different states previously loaded on the page
    if (!this.currentState || keepIndex === 0)
        return;

    // remove all backbone views by calling unload up till the keepIndex
    for (var i = this.currentState.path.length - 1; i > keepIndex - 1; i--) {
        var state = this.currentState.path[i];

        // remove elements from the DOM
        if (state.views) {
            _.each(state.views, function(content, view) {
                var ui = this.getUiView(view);

                var domState = Backbone.$(this.rootEl).find("[state='" + ui.state + "']");

                if (!domState)
                    return;

                if (i === keepIndex) {
                    Backbone.$(domState).find("[ui-view='" + ui.view + "']").empty();
                } else {
                    Backbone.$(domState).find("[ui-view='" + ui.view + "']").remove();
                }

            }.bind(this))
        }

        // call unload on every loaded controller matching the state
        if (Object.prototype.hasOwnProperty.call(this.loadedControllers, state.name)) {

            if (Object.prototype.hasOwnProperty.call(this.loadedControllers[state.name], 'unload')) {
                this.loadedControllers[state.name].unload();
            } else {
                _.each(this.loadedControllers[state.name], function(controller) {
                    if (Object.prototype.hasOwnProperty.call(controller, 'unload')) {
                        controller.unload();
                    }
                });
            }

            delete this.loadedControllers[state.name];
        }
    }

    this.stateHistory.unshift(this.currentState);
}

pageManager.prototype.loadState = function(state, queryString) {
    var deferred = q.defer();

    var queryString = queryString || '';

    // broadcast onloadStarted

    // let's check if we're moving back to the previous page.
    var navigatingTo = Backbone.history.getFragment();

    // The '0' index is a bit confusing, but the page we're navigating away from hasn't been added 
    // to Backbone's history yet. So _pageHistory[0] is the page before the one we're navigating from.
    if (this.stateHistory[0] && this.stateHistory[0].query == navigatingTo) {
        this.clickedBack = true;
        Backbone.history.length--;
    } else {
        this.clickedBack = false;
        Backbone.history.length++;
    }

    /*
        get toParams from the querystring and 
        get fromParams from the current state if it exist otherwise return empty
    */
    var queryStringIndex = queryString.indexOf("?");
    var cleanUrl = queryString;
    var query = "";
    
    if (queryStringIndex > -1) {
        query = cleanUrl.substr(queryStringIndex+1);
        cleanUrl = cleanUrl.substr(0, queryStringIndex) || "";
    }

    var toParams = state.url.exec(cleanUrl);
    
    var queryData = {};
    var search = /([^&=]+)=?([^&]*)/g;
    var match = null;
    while (match = search.exec(query)){
        queryData[match[1]] = match[2];
    }

    if(toParams !== null){
        toParams.query = queryData;
    }

    state['params'] = toParams
    state['query'] = queryString;

    // get common ancestors
    var commonStates = (this.currentState) ? this.ancestors(state, this.currentState) : [];
    var keepIndex = commonStates.length;

    // unload previous state
    this.unloadPreviousState(keepIndex);

    this.transitionTo(state, toParams, {
            keep: keepIndex
        })
        .then(function() {
            document.body.scrollTop = 0;

            // once we're done loading the state set currentstate
            this.currentState = state;

            deferred.resolve('success');
        }.bind(this))
        .catch(function(error) {
            // error
            console.log(error);
            deferred.reject(error);
        }.bind(this));

    return deferred.promise;
}

pageManager.prototype.instantiateView = function(viewInfo) {
    if (!viewInfo || !_.isObject(viewInfo) || !Object.prototype.hasOwnProperty.call(viewInfo, 'view')) {
        console.error(' -- invalid view information passed to pageManager.instantiateView()');
        return;
    }

    var View = viewInfo.view;
    var viewParams = _.extend({}, viewInfo.params);

    // instantiate the View
    var instance = new View(viewParams);

    // store the View in as best a hierarchy as we can manage. This can help with debugging, but it
    // relies on all developers instantiating Views within Views
    var cleanInfo = {
        cid: instance.cid,
        name: instance.name,
        instance: instance,
        parentCid: viewInfo.hasOwnProperty('cid') ? viewInfo.cid : null
    };

    /*var found = _placeViewDetails(_currPageViews, cleanInfo);
    if (!found) {
        _currPageViews[cleanInfo.cid] = {
            name: cleanInfo.name,
            instance: instance,
            views: {}
        };
    }*/

    return instance;
};

pageManager.prototype.instantiateModel = function(modelInfo) {
    if (!modelInfo || !_.isObject(modelInfo) || !Object.prototype.hasOwnProperty.call(modelInfo, 'model')) {
        console.error(' -- invalid model information passed to pageManager.instantiateModel()');
        return;
    }

    var Model = modelInfo.model;
    
    var instance = null;

    if(modelInfo.params !== null){
        instance = new Model(modelInfo.params);
    }else{
        instance = new Model();
    }

    return instance;
};



pageManager.prototype.setRoot = function(domEl) {
    this.rootEl = domEl;
}

pageManager.prototype.findState = function(stateName) {
    var output = null;

    _.each(this.states, function(content, name) {
        if (!Object.prototype.hasOwnProperty.call(content, 'abstract') || !content.abstract) {
            if (name === stateName) {
                output = content;
            }
        }
    });

    return output;
}


/**
* exposing functions
*/

var self = module.exports = {
    instance: null,
    init: function(router, states, options){
        self.instance = new pageManager(router, states, options);
    },
    isInstantiated: function(){
        if(self.instance === null){
            throw new Error('pageManager instance has not been instantiated');     
        }
    },
    loadState: function(state, queryString){
        self.isInstantiated();

        return self.instance.loadState(state, queryString);
    },
    findState: function(stateName){
        self.isInstantiated();

        return self.instance.findState(stateName);
    },
    goTo: function(){
        self.isInstantiated();

        return self.instance.goTo();
    },
    navigateTo: function(url, options){
        self.isInstantiated();

        return self.instance.navigateTo(url, options);
    },
    instantiateView: function(options){
        self.isInstantiated();

        return self.instance.instantiateView(options);
    },
    instantiateModel: function(options){
        self.isInstantiated();

        return self.instance.instantiateModel(options);
    },
    setRoot: function(domEl){
        self.isInstantiated();

        return self.instance.setRoot(domEl);
    },
    getRoot: function(){
        self.isInstantiated();

        return self.instance.rootEl;
    }
}