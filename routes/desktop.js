'use strict';
var express = require('express'),
    router = express.Router(),
    passport = require('passport');


router.get('/', function(req, res) {
    res.render('login');
});

router.post('/login', 
	passport.authenticate('local', { failureRedirect: '/desktop' }),
    function(req, res) {
        res.redirect('/desktop/start');
    });

router.get('/logout', function(req, res) {
      req.logout();
      res.redirect('/');
});


router.get('/register', function(req, res) {
    res.render('register');
});

router.get('/create-task', function(req, res) {
    res.render('create-task');
});

router.get('/start', function(req, res) {
  res.render('start');
});

module.exports = router;
