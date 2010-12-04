/**
 * JsHttpRequest: JavaScript "AJAX" data loader
 *
 * @license LGPL
 * @author Dmitry Koterov, http://en.dklab.ru/lib/JsHttpRequest/
 * @version 5.x $Id$
 */

// {{{
function JsHttpRequest() {
    // Standard properties.
    var t = this;
    t.onreadystatechange = null;
    t.readyState         = 0;
    t.responseText       = null;
    t.responseXML        = null;
    t.status             = 200;
    t.statusText         = "OK";
    // JavaScript response array/hash
    t.responseJS         = null;

    // Additional properties.
    t.caching            = false;        // need to use caching?
    t.loader             = null;         // loader to use ('form', 'script', 'xml'; null - autodetect)
    t.session_name       = "PHPSESSID";  // set to SID cookie or GET parameter name

    // Internals.
    t._ldObj              = null;  // used loader object
    t._reqHeaders        = [];    // collected request headers
    t._openArgs          = null;  // parameters from open()
    t._errors = {
        inv_form_el:        'Invalid FORM element detected: name=%, tag=%',
        must_be_single_el:  'If used, <form> must be a single HTML element in the list.',
        js_invalid:         'JavaScript code generated by backend is invalid!\n%',
        url_too_long:       'Cannot use so long query with GET request (URL is larger than % bytes)',
        unk_loader:         'Unknown loader: %',
        no_loaders:         'No loaders registered at all, please check JsHttpRequest.LOADERS array',
        no_loader_matched:  'Cannot find a loader which may process the request. Notices are:\n%'
    }
    
    /**
     * Aborts the request. Behaviour of this function for onreadystatechange() 
     * is identical to IE (most universal and common case). E.g., readyState -> 4
     * on abort() after send().
     */
    t.abort = function() { with (this) {
        if (_ldObj && _ldObj.abort) _ldObj.abort();
        _cleanup();
        if (readyState == 0) {
            // start->abort: no change of readyState (IE behaviour)
            return;
        }
        if (readyState == 1 && !_ldObj) {
            // open->abort: no onreadystatechange call, but change readyState to 0 (IE).
            // send->abort: change state to 4 (_ldObj is not null when send() is called)
            readyState = 0;
            return;
        }
        _changeReadyState(4, true); // 4 in IE & FF on abort() call; Opera does not change to 4.
    }}
    
    /**
     * Prepares the object for data loading.
     * You may also pass URLs like "GET url" or "script.GET url".
     */
    t.open = function(method, url, asyncFlag, username, password) { with (this) {
        // Extract methor and loader from the URL (if present).
        if (url.match(/^((\w+)\.)?(GET|POST)\s+(.*)/i)) {
            this.loader = RegExp.$2? RegExp.$2 : null;
            method = RegExp.$3;
            url = RegExp.$4; 
        }
        // Append SID to original URL. Use try...catch for security problems.
        try {
            if (
                document.location.search.match(new RegExp('[&?]' + session_name + '=([^&?]*)'))
                || document.cookie.match(new RegExp('(?:;|^)\\s*' + session_name + '=([^;]*)'))
            ) {
                url += (url.indexOf('?') >= 0? '&' : '?') + session_name + "=" + this.escape(RegExp.$1);
            }
        } catch (e) {}
        // Store open arguments to hash.
        _openArgs = {
            method:     (method || '').toUpperCase(),
            url:        url,
            asyncFlag:  asyncFlag,
            username:   username != null? username : '',
            password:   password != null? password : ''
        }
        _ldObj = null;
        _changeReadyState(1, true); // compatibility with XMLHttpRequest
        return true;
    }}
    
    /**
     * Sends a request to a server.
     */
    t.send = function(content) {
        if (!this.readyState) {
            // send without open or after abort: no action (IE behaviour).
            return;
        }
        this._changeReadyState(1, true); // compatibility with XMLHttpRequest
        this._ldObj = null;
        
        // Prepare to build QUERY_STRING from query hash.
        var queryText = [];
        var queryElem = [];
        if (!this._hash2query(content, null, queryText, queryElem)) return;
    
        // Solve the query hashcode & return on cache hit.
        var hash = null;
        if (this.caching && !queryElem.length) {
            hash = this._openArgs.username + ':' + this._openArgs.password + '@' + this._openArgs.url + '|' + queryText + "#" + this._openArgs.method;
            var cache = JsHttpRequest.CACHE[hash];
            if (cache) {
                this._dataReady(cache[0], cache[1]);
                return false;
            }
        }
    
        // Try all the loaders.
        var loader = (this.loader || '').toLowerCase();
        if (loader && !JsHttpRequest.LOADERS[loader]) return this._error('unk_loader', loader);
        var errors = [];
        var lds = JsHttpRequest.LOADERS;
        for (var tryLoader in lds) {
            var ldr = lds[tryLoader].loader;
            if (!ldr) continue; // exclude possibly derived prototype properties from "for .. in".
            if (loader && tryLoader != loader) continue;
            // Create sending context.
            var ldObj = new ldr(this);
            JsHttpRequest.extend(ldObj, this._openArgs);
            JsHttpRequest.extend(ldObj, {
                queryText:  queryText.join('&'),
                queryElem:  queryElem,
                id:         (new Date().getTime()) + "" + JsHttpRequest.COUNT++,
                hash:       hash,
                span:       null
            });
            var error = ldObj.load();
            if (!error) {
                // Save loading script.
                this._ldObj = ldObj;
                JsHttpRequest.PENDING[ldObj.id] = this;
                return true;
            }
            if (!loader) {
                errors[errors.length] = '- ' + tryLoader.toUpperCase() + ': ' + this._l(error);
            } else {
                return this._error(error);
            }
        }
    
        // If no loader matched, generate error message.
        return tryLoader? this._error('no_loader_matched', errors.join('\n')) : this._error('no_loaders');
    }
    
    /**
     * Returns all response headers (if supported).
     */
    t.getAllResponseHeaders = function() { with (this) {
        return _ldObj && _ldObj.getAllResponseHeaders? _ldObj.getAllResponseHeaders() : [];
    }}

    /**
     * Returns one response header (if supported).
     */
    t.getResponseHeader = function(label) { with (this) {
        return _ldObj && _ldObj.getResponseHeader? _ldObj.getResponseHeader(label) : null;
    }}

    /**
     * Adds a request header to a future query.
     */
    t.setRequestHeader = function(label, value) { with (this) {
        _reqHeaders[_reqHeaders.length] = [label, value];
    }}
    
    //
    // Internal functions.
    //
    
    /**
     * Do all the work when a data is ready.
     */
    t._dataReady = function(text, js) { with (this) {
        if (caching && _ldObj) JsHttpRequest.CACHE[_ldObj.hash] = [text, js];
        responseText = responseXML = text;
        responseJS = js;
        if (js !== null) {
            status = 200;
            statusText = "OK";
        } else {
            status = 500;
            statusText = "Internal Server Error";
        }
        _changeReadyState(2);
        _changeReadyState(3);
        _changeReadyState(4);
        _cleanup();
    }}
    
    /**
     * Analog of sprintf(), but translates the first parameter by _errors.
     */
    t._l = function(args) {
        var i = 0, p = 0, msg = this._errors[args[0]];
        // Cannot use replace() with a callback, because it is incompatible with IE5.
        while ((p = msg.indexOf('%', p)) >= 0) {
            var a = args[++i] + "";
            msg = msg.substring(0, p) + a + msg.substring(p + 1, msg.length);
            p += 1 + a.length;
        }
        return msg;
    }

    /** 
     * Called on error.
     */
    t._error = function(msg) {
        msg = this._l(typeof(msg) == 'string'? arguments : msg)
        msg = "JsHttpRequest: " + msg;
        if (!window.Error) {
            // Very old browser...
            throw msg;
        } else if ((new Error(1, 'test')).description == "test") {
            // We MUST (!!!) pass 2 parameters to the Error() constructor for IE5.
            throw new Error(1, msg);
        } else {
            // Mozilla does not support two-parameter call style.
            throw new Error(msg);
        }
    }
    
    /**
     * Convert hash to QUERY_STRING.
     * If next value is scalar or hash, push it to queryText.
     * If next value is form element, push [name, element] to queryElem.
     */
    t._hash2query = function(content, prefix, queryText, queryElem) {
        if (prefix == null) prefix = "";
        if((''+typeof(content)).toLowerCase() == 'object') {
            var formAdded = false;
            if (content && content.parentNode && content.parentNode.appendChild && content.tagName && content.tagName.toUpperCase() == 'FORM') {
                content = { form: content };
            }
            for (var k in content) {
                var v = content[k];
                if (v instanceof Function) continue;
                var curPrefix = prefix? prefix + '[' + this.escape(k) + ']' : this.escape(k);
                var isFormElement = v && v.parentNode && v.parentNode.appendChild && v.tagName;
                if (isFormElement) {
                    var tn = v.tagName.toUpperCase();
                    if (tn == 'FORM') {
                        // FORM itself is passed.
                        formAdded = true;
                    } else if (tn == 'INPUT' || tn == 'TEXTAREA' || tn == 'SELECT') {
                        // This is a single form elemenent.
                    } else {
                        return this._error('inv_form_el', (v.name||''), v.tagName);
                    }
                    queryElem[queryElem.length] = { name: curPrefix, e: v };
                } else if (v instanceof Object) {
                    this._hash2query(v, curPrefix, queryText, queryElem);
                } else {
                    // We MUST skip NULL values, because there is no method
                    // to pass NULL's via GET or POST request in PHP.
                    if (v === null) continue;
                    // Convert JS boolean true and false to corresponding PHP values.
                    if (v === true) v = 1; 
                    if (v === false) v = '';
                    queryText[queryText.length] = curPrefix + "=" + this.escape('' + v);
                }
                if (formAdded && queryElem.length > 1) {
                    return this._error('must_be_single_el');
                }
            }
        } else {
            queryText[queryText.length] = content;
        }
        return true;
    }
    
    /**
     * Remove last used script element (clean memory).
     */
    t._cleanup = function() {
        var ldObj = this._ldObj;
        if (!ldObj) return;
        // Mark this loading as aborted.
        JsHttpRequest.PENDING[ldObj.id] = false;
        var span = ldObj.span;
        if (!span) return;
        // Do NOT use iframe.contentWindow.back() - it is incompatible with Opera 9!
        ldObj.span = null;
        var closure = function() {
            span.parentNode.removeChild(span);
        }
        // IE5 crashes on setTimeout(function() {...}, ...) construction! Use tmp variable.
        JsHttpRequest.setTimeout(closure, 50);
    }
    
    /**
     * Change current readyState and call trigger method.
     */
    t._changeReadyState = function(s, reset) { with (this) {
        if (reset) {
            status = statusText = responseJS = null;
            responseText = '';
        }
        readyState = s;
        if (onreadystatechange) onreadystatechange();
    }}
    
    /**
     * JS escape() does not quote '+'.
     */
    t.escape = function(s) {
        return escape(s).replace(new RegExp('\\+','g'), '%2B');
    }
}


// Global library variables.
JsHttpRequest.COUNT = 0;              // unique ID; used while loading IDs generation
JsHttpRequest.MAX_URL_LEN = 2000;     // maximum URL length
JsHttpRequest.CACHE = {};             // cached data
JsHttpRequest.PENDING = {};           // pending loadings
JsHttpRequest.LOADERS = {};           // list of supported data loaders (filled at the bottom of the file)
JsHttpRequest._dummy = function() {}; // avoid memory leaks


/**
 * These functions are dirty hacks for IE 5.0 which does not increment a
 * reference counter for an object passed via setTimeout(). So, if this 
 * object (closure function) is out of scope at the moment of timeout 
 * applying, IE 5.0 crashes. 
 */

/**
 * Timeout wrappers storage. Used to avoid zeroing of referece counts in IE 5.0.
 * Please note that you MUST write "window.setTimeout", not "setTimeout", else
 * IE 5.0 crashes again. Strange, very strange...
 */
JsHttpRequest.TIMEOUTS = { s: window.setTimeout, c: window.clearTimeout };

/**
 * Wrapper for IE5 buggy setTimeout.
 * Use this function instead of a usual setTimeout().
 */
JsHttpRequest.setTimeout = function(func, dt) {
    // Always save inside the window object before a call (for FF)!
    window.JsHttpRequest_tmp = JsHttpRequest.TIMEOUTS.s; 
    if (typeof(func) == "string") {
        id = window.JsHttpRequest_tmp(func, dt);
    } else {
        var id = null;
        var mediator = function() {
            func();
            delete JsHttpRequest.TIMEOUTS[id]; // remove circular reference
        }
        id = window.JsHttpRequest_tmp(mediator, dt);
        // Store a reference to the mediator function to the global array
        // (reference count >= 1); use timeout ID as an array key;
        JsHttpRequest.TIMEOUTS[id] = mediator;
    }
    window.JsHttpRequest_tmp = null; // no delete() in IE5 for window
    return id;
}

/**
 * Complimental wrapper for clearTimeout. 
 * Use this function instead of usual clearTimeout().
 */
JsHttpRequest.clearTimeout = function(id) {
    window.JsHttpRequest_tmp = JsHttpRequest.TIMEOUTS.c;
    delete JsHttpRequest.TIMEOUTS[id]; // remove circular reference
    var r = window.JsHttpRequest_tmp(id);
    window.JsHttpRequest_tmp = null; // no delete() in IE5 for window
    return r;
}


/**
 * Global static function.
 * Simple interface for most popular use-cases.
 * You may also pass URLs like "GET url" or "script.GET url".
 */
JsHttpRequest.query = function(url, content, onready, nocache) {
    var req = new this();
    req.caching = !nocache;
    req.onreadystatechange = function() {
        if (req.readyState == 4) {
            onready(req.responseJS, req.responseText);
        }
    }
    req.open(null, url, true);
    req.send(content);
}


/**
 * Global static function.
 * Called by server backend script on data load.
 */
JsHttpRequest.dataReady = function(d) {
    var th = this.PENDING[d.id];
    delete this.PENDING[d.id];
    if (th) {
        th._dataReady(d.text, d.js);
    } else if (th !== false) {
        throw "dataReady(): unknown pending id: " + d.id;
    }
}


// Adds all the properties of src to dest.
JsHttpRequest.extend = function(dest, src) {
    for (var k in src) dest[k] = src[k];
}

/**
 * Each loader has the following properties which must be initialized:
 * - method
 * - url
 * - asyncFlag (ignored)
 * - username
 * - password
 * - queryText (string)
 * - queryElem (array)
 * - id
 * - hash
 * - span
 */ 
 
// }}}

// {{{ xml
// Loader: XMLHttpRequest or ActiveX.
// [+] GET and POST methods are supported.
// [+] Most native and memory-cheap method.
// [+] Backend data can be browser-cached.
// [-] Cannot work in IE without ActiveX. 
// [-] No support for loading from different domains.
// [-] No uploading support.
//
JsHttpRequest.LOADERS.xml = { loader: function(req) {
    JsHttpRequest.extend(req._errors, {
        xml_no:          'Cannot use XMLHttpRequest or ActiveX loader: not supported',
        xml_no_diffdom:  'Cannot use XMLHttpRequest to load data from different domain %',
        xml_no_headers:  'Cannot use XMLHttpRequest loader or ActiveX loader, POST method: headers setting is not supported, needed to work with encodings correctly',
        xml_no_form_upl: 'Cannot use XMLHttpRequest loader: direct form elements using and uploading are not implemented'
    });
    
    this.load = function() {
        if (this.queryElem.length) return ['xml_no_form_upl'];
        
        // XMLHttpRequest (and MS ActiveX'es) cannot work with different domains.
        if (this.url.match(new RegExp('^([a-z]+://[^\\/]+)(.*)', 'i'))) {
        	// We MUST also check if protocols matched: cannot send from HTTP 
        	// to HTTPS and vice versa.
            if (RegExp.$1.toLowerCase() != document.location.protocol + '//' + document.location.hostname.toLowerCase()) {
                return ['xml_no_diffdom', RegExp.$1];
            }
        }
        
        // Try to obtain a loader.
        var xr = null;
        if (window.XMLHttpRequest) {
            try { xr = new XMLHttpRequest() } catch(e) {}
        } else if (window.ActiveXObject) {
            try { xr = new ActiveXObject("Microsoft.XMLHTTP") } catch(e) {}
            if (!xr) try { xr = new ActiveXObject("Msxml2.XMLHTTP") } catch (e) {}
        }
        if (!xr) return ['xml_no'];
        
        // Loading method detection. We cannot POST if we cannot set "octet-stream" 
        // header, because we need to process the encoded data in the backend manually.
        var canSetHeaders = window.ActiveXObject || xr.setRequestHeader;
        if (!this.method) this.method = canSetHeaders && this.queryText.length? 'POST' : 'GET';
        
        // Build & validate the full URL.
        if (this.method == 'GET') {
            if (this.queryText) this.url += (this.url.indexOf('?') >= 0? '&' : '?') + this.queryText;
            this.queryText = '';
            if (this.url.length > JsHttpRequest.MAX_URL_LEN) return ['url_too_long', JsHttpRequest.MAX_URL_LEN];
        } else if (this.method == 'POST' && !canSetHeaders) {
            return ['xml_no_headers'];
        }
        
        // Add ID to the url if we need to disable the cache.
        this.url += (this.url.indexOf('?') >= 0? '&' : '?') + 'JsHttpRequest=' + (req.caching? '0' : this.id) + '-xml';        
        
        // Assign the result handler.
        var id = this.id;
        xr.onreadystatechange = function() { 
            if (xr.readyState != 4) return;
            // Avoid memory leak by removing the closure.
            xr.onreadystatechange = JsHttpRequest._dummy;
            req.status = null;
            try { 
                // In case of abort() call, xr.status is unavailable and generates exception.
                // But xr.readyState equals to 4 in this case. Stupid behaviour. :-(
                req.status = xr.status;
                req.responseText = xr.responseText;
            } catch (e) {}
            if (!req.status) return;
            try {
                // Prepare generator function & catch syntax errors on this stage.
                eval('JsHttpRequest._tmp = function(id) { var d = ' + req.responseText + '; d.id = id; JsHttpRequest.dataReady(d); }');
            } catch (e) {
                // Note that FF 2.0 does not throw any error from onreadystatechange handler.
                return req._error('js_invalid', req.responseText)
            }
            // Call associated dataReady() outside the try-catch block 
            // to pass exceptions in onreadystatechange in usual manner.
            JsHttpRequest._tmp(id);
            JsHttpRequest._tmp = null;
        };

        // Open & send the request.
        xr.open(this.method, this.url, true, this.username, this.password);
        if (canSetHeaders) {
            // Pass pending headers.
            for (var i = 0; i < req._reqHeaders.length; i++) {
                xr.setRequestHeader(req._reqHeaders[i][0], req._reqHeaders[i][1]);
            }
            // Set non-default Content-type. We cannot use 
            // "application/x-www-form-urlencoded" here, because 
            // in PHP variable HTTP_RAW_POST_DATA is accessible only when 
            // enctype is not default (e.g., "application/octet-stream" 
            // is a good start). We parse POST data manually in backend 
            // library code. Note that Safari sets by default "x-www-form-urlencoded"
            // header, but FF sets "text/xml" by default.
            xr.setRequestHeader('Content-Type', 'application/octet-stream');
        }
        xr.send(this.queryText);
        
        // No SPAN is used for this loader.
        this.span = null;
        this.xr = xr; // save for later usage on abort()
        
        // Success.
        return null;
    }
    
    // Override req.getAllResponseHeaders method.
    this.getAllResponseHeaders = function() {
        return this.xr.getAllResponseHeaders();
    }
    
    // Override req.getResponseHeader method.
    this.getResponseHeader = function(label) {
        return this.xr.getResponseHeader(label);
    }

    this.abort = function() {
        this.xr.abort();
        this.xr = null;
    }
}}
// }}}


// {{{ script
// Loader: SCRIPT tag.
// [+] Most cross-browser. 
// [+] Supports loading from different domains.
// [-] Only GET method is supported.
// [-] No uploading support.
// [-] Backend data cannot be browser-cached.
//
JsHttpRequest.LOADERS.script = { loader: function(req) {
    JsHttpRequest.extend(req._errors, {
        script_only_get:   'Cannot use SCRIPT loader: it supports only GET method',
        script_no_form:    'Cannot use SCRIPT loader: direct form elements using and uploading are not implemented'
    })
    
    this.load = function() {
        // Move GET parameters to the URL itself.
        if (this.queryText) this.url += (this.url.indexOf('?') >= 0? '&' : '?') + this.queryText;
        this.url += (this.url.indexOf('?') >= 0? '&' : '?') + 'JsHttpRequest=' + this.id + '-' + 'script';        
        this.queryText = '';
        
        if (!this.method) this.method = 'GET';
        if (this.method !== 'GET') return ['script_only_get'];
        if (this.queryElem.length) return ['script_no_form'];
        if (this.url.length > JsHttpRequest.MAX_URL_LEN) return ['url_too_long', JsHttpRequest.MAX_URL_LEN];

        var th = this, d = document, s = null, b = d.body;
        if (!window.opera) {
            // Safari, IE, FF, Opera 7.20.
            this.span = s = d.createElement('SCRIPT');
            var closure = function() {
                s.language = 'JavaScript';
                if (s.setAttribute) s.setAttribute('src', th.url); else s.src = th.url;
                b.insertBefore(s, b.lastChild);
            }
        } else {
            // Oh shit! Damned stupid Opera 7.23 does not allow to create SCRIPT 
            // element over createElement (in HEAD or BODY section or in nested SPAN - 
            // no matter): it is created deadly, and does not response the href assignment.
            // So - always create SPAN.
            this.span = s = d.createElement('SPAN');
            s.style.display = 'none';
            b.insertBefore(s, b.lastChild);
            s.innerHTML = 'Workaround for IE.<s'+'cript></' + 'script>';
            var closure = function() {
                s = s.getElementsByTagName('SCRIPT')[0]; // get with timeout!
                s.language = 'JavaScript';
                if (s.setAttribute) s.setAttribute('src', th.url); else s.src = th.url;
            }
        }
        JsHttpRequest.setTimeout(closure, 10);
        
        // Success.
        return null;
    }
}}
// }}}


// {{{ form
// Loader: FORM & IFRAME.
// [+] Supports file uploading.
// [+] GET and POST methods are supported.
// [+] Supports loading from different domains.
// [-] Uses a lot of system resources.
// [-] Backend data cannot be browser-cached.
// [-] Pollutes browser history on some old browsers.
//
JsHttpRequest.LOADERS.form = { loader: function(req) {
    JsHttpRequest.extend(req._errors, {
        form_el_not_belong:  'Element "%" does not belong to any form!',
        form_el_belong_diff: 'Element "%" belongs to a different form. All elements must belong to the same form!',
        form_el_inv_enctype: 'Attribute "enctype" of the form must be "%" (for IE), "%" given.'
    })
    
    this.load = function() {
        var th = this;
     
        if (!th.method) th.method = 'POST';
        th.url += (th.url.indexOf('?') >= 0? '&' : '?') + 'JsHttpRequest=' + th.id + '-' + 'form';
        
        // If GET, build full URL. Then copy QUERY_STRING to queryText.
        if (th.method == 'GET') {
            if (th.queryText) th.url += (th.url.indexOf('?') >= 0? '&' : '?') + th.queryText;
            if (th.url.length > JsHttpRequest.MAX_URL_LEN) return ['url_too_long', JsHttpRequest.MAX_URL_LEN];
            var p = th.url.split('?', 2);
            th.url = p[0];
            th.queryText = p[1] || '';
        }

        // Check if all form elements belong to same form.
        var form = null;
        var wholeFormSending = false;
        if (th.queryElem.length) {
            if (th.queryElem[0].e.tagName.toUpperCase() == 'FORM') {
                // Whole FORM sending.
                form = th.queryElem[0].e;
                wholeFormSending = true;
                th.queryElem = [];
            } else {
                // If we have at least one form element, we use its FORM as a POST container.
                form = th.queryElem[0].e.form;
                // Validate all the elements.
                for (var i = 0; i < th.queryElem.length; i++) {
                    var e = th.queryElem[i].e;
                    if (!e.form) {
                        return ['form_el_not_belong', e.name];
                    }
                    if (e.form != form) {
                        return ['form_el_belong_diff', e.name];
                    }
                }
            }
            
            // Check enctype of the form.
            if (th.method == 'POST') {
                var need = "multipart/form-data";
                var given = (form.attributes.encType && form.attributes.encType.nodeValue) || (form.attributes.enctype && form.attributes.enctype.value) || form.enctype;
                if (given != need) {
                    return ['form_el_inv_enctype', need, given];
                }
            }
        }

        // Create invisible IFRAME with temporary form (form is used on empty queryElem).
        // We ALWAYS create th IFRAME in the document of the form - for Opera 7.20.
        var d = form && (form.ownerDocument || form.document) || document;
        var ifname = 'jshr_i_' + th.id;
        var s = th.span = d.createElement('DIV');
        s.style.position = 'absolute';
        s.style.display = 'none';
        s.style.visibility = 'hidden';
        s.innerHTML = 
            (form? '' : '<form' + (th.method == 'POST'? ' enctype="multipart/form-data" method="post"' : '') + '></form>') + // stupid IE, MUST use innerHTML assignment :-(
            '<iframe name="' + ifname + '" id="' + ifname + '" style="width:0px; height:0px; overflow:hidden; border:none"></iframe>'
        if (!form) {
            form = th.span.firstChild;
        }

        // Insert generated form inside the document.
        // Be careful: don't forget to close FORM container in document body!
        d.body.insertBefore(s, d.body.lastChild);

        // Function to safely set the form attributes. Parameter attr is NOT a hash 
        // but an array, because "for ... in" may badly iterate over derived attributes.
        var setAttributes = function(e, attr) {
            var sv = [];
            var form = e;
            // This strange algorythm is needed, because form may  contain element 
            // with name like 'action'. In IE for such attribute will be returned
            // form element node, not form action. Workaround: copy all attributes
            // to new empty form and work with it, then copy them back. This is
            // THE ONLY working algorythm since a lot of bugs in IE5.0 (e.g. 
            // with e.attributes property: causes IE crash).
            if (e.mergeAttributes) {
                var form = d.createElement('form');
                form.mergeAttributes(e, false);
            }
            for (var i = 0; i < attr.length; i++) {
                var k = attr[i][0], v = attr[i][1];
                // TODO: http://forum.dklab.ru/viewtopic.php?p=129059#129059
                sv[sv.length] = [k, form.getAttribute(k)];
                form.setAttribute(k, v);
            }
            if (e.mergeAttributes) {
                e.mergeAttributes(form, false);
            }
            return sv;
        }

        // Run submit with delay - for old Opera: it needs some time to create IFRAME.
        var closure = function() {
            // Save JsHttpRequest object to new IFRAME.
            top.JsHttpRequestGlobal = JsHttpRequest;
            
            // Disable ALL the form elements.
            var savedNames = [];
            if (!wholeFormSending) {
                for (var i = 0, n = form.elements.length; i < n; i++) {
                    savedNames[i] = form.elements[i].name;
                    form.elements[i].name = '';
                }
            }

            // Insert hidden fields to the form.
            var qt = th.queryText.split('&');
            for (var i = qt.length - 1; i >= 0; i--) {
                var pair = qt[i].split('=', 2);
                var e = d.createElement('INPUT');
                e.type = 'hidden';
                e.name = unescape(pair[0]);
                e.value = pair[1] != null? unescape(pair[1]) : '';
                form.appendChild(e);
            }


            // Change names of along user-passed form elements.
            for (var i = 0; i < th.queryElem.length; i++) {
                th.queryElem[i].e.name = th.queryElem[i].name;
            }

            // Temporary modify form attributes, submit form, restore attributes back.
            var sv = setAttributes(
                form, 
                [
                    ['action',   th.url],
                    ['method',   th.method],
                    ['onsubmit', null],
                    ['target',   ifname]
                ]
            );
            form.submit();
            setAttributes(form, sv);

            // Remove generated temporary hidden elements from the top of the form.
            for (var i = 0; i < qt.length; i++) {
                // Use "form.firstChild.parentNode", not "form", or IE5 crashes!
                form.lastChild.parentNode.removeChild(form.lastChild);
            }
            // Enable all disabled elements back.
            if (!wholeFormSending) {
                for (var i = 0, n = form.elements.length; i < n; i++) {
                    form.elements[i].name = savedNames[i];
                }
            }
        }
        JsHttpRequest.setTimeout(closure, 100);

        // Success.
        return null;
    }    
}}
// }}}

