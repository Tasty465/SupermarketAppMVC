const UserModel = require('../Models/user');
const bcrypt = require('bcrypt');

// Helper to call model functions that may be callback-style or promise-style
function modelCall(fn, ...args) {
	// Returns a Promise that resolves with the model result or rejects with an error.
	return new Promise((resolve, reject) => {
		let settled = false;
		const cb = (err, result) => {
			if (settled) return;
			settled = true;
			if (err) return reject(err);
			resolve(result);
		};
		let ret;
		try {
			ret = fn(...args, cb);
		} catch (e) {
			return reject(e);
		}
		// If the model returned a thenable, use it (some models return promises)
		if (ret && typeof ret.then === 'function') {
			ret.then((r) => {
				if (!settled) {
					settled = true;
					resolve(r);
				}
			}).catch((e) => {
				if (!settled) {
					settled = true;
					reject(e);
				}
			});
		}
	});
}

// new helper: normalize DB return shapes (e.g. [rows, fields] or [rows])
function normalizeResult(result) {
	// If mysql2 returns [rows, fields], or some libs return [rows]
	if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) {
		return result[0];
	}
	return result;
}

/**
 * UserController - function based (Express handlers)
 * Uses UserModel for user-only fields and handles hashing/auth where appropriate.
 */
const UserController = {
	/* new middleware: attach current user to res.locals so EJS views can reference `user` safely */
	attachUser: function (req, res, next) {
		// set res.locals.user for templates
		res.locals.user = req.user || null;
		// also keep req.user unchanged
		next();
	},

	list: async function (req, res) {
		try {
			const raw = await modelCall(UserModel.getAll.bind(UserModel));
			const users = normalizeResult(raw);
			// include user as fallback in case middleware wasn't mounted
			res.render('users', { users, user: req.user || res.locals.user || null });
		} catch (err) {
			console.error('Error fetching users:', err);
			return res.status(500).send('Internal Server Error');
		}
	},

	getById: async function (req, res) {
		const id = req.params.id;
		try {
			const raw = await modelCall(UserModel.getById.bind(UserModel), id);
			let user = normalizeResult(raw);
			if (Array.isArray(user)) user = user[0];
			if (!user) return res.status(404).send('User not found');
			res.render('profile', { user, currentUser: req.user || res.locals.user || null });
		} catch (err) {
			console.error(`Error fetching user ${id}:`, err);
			return res.status(500).send('Internal Server Error');
		}
	},

	registerForm: function (req, res) {
		// include user so template checks won't fail
		res.render('register', { user: req.user || res.locals.user || null });
	},

	register: async function (req, res) {
		try {
			const userData = {
				// accept either field name coming from forms
				username: req.body.username || req.body.userName || req.body.name || null,
				email: req.body.email || null,
				password: req.body.password || null,
				address: req.body.address || null,
				contact: req.body.contact || null,
				// accept role directly from the form but normalize to 'admin' or 'user'
				role: (req.body.role === 'admin') ? 'admin' : 'user'
			};

			if (userData.password) {
				userData.password = await bcrypt.hash(userData.password, 10);
			}
			await modelCall(UserModel.create.bind(UserModel), userData);
			res.redirect('/login');
		} catch (err) {
			console.error('Error creating user:', err);
			return res.status(500).send('Internal Server Error');
		}
	},

	loginForm: function (req, res) {
		res.render('login', { user: req.user || res.locals.user || null });
	},

	login: async function (req, res) {
		// form may send email or username into the same "email" field
		const loginValue = (req.body.email || req.body.userName || req.body.username || '').trim();
		const password = req.body.password;

		if (!loginValue || !password) {
			return res.render('login', {
				errors: ['Email/username and password are required'],
				messages: [],
				formData: { email: loginValue },
				user: req.user || res.locals.user || null
			});
		}

		try {
			// try by email first
			let raw = await modelCall(UserModel.getByEmail.bind(UserModel), loginValue);
			let user = normalizeResult(raw);
			if (Array.isArray(user)) user = user[0];

			// if not found by email, try by username using same loginValue
			if (!user) {
				raw = await modelCall(UserModel.getByUsername.bind(UserModel), loginValue);
				user = normalizeResult(raw);
				if (Array.isArray(user)) user = user[0];
			}

			if (!user) {
				return res.render('login', {
					errors: ['Invalid email/username or password'],
					messages: [],
					formData: { email: loginValue },
					user: req.user || res.locals.user || null
				});
			}

			const match = await bcrypt.compare(password, user.password || '');
			if (!match) {
				return res.render('login', {
					errors: ['Invalid email/username or password'],
					messages: [],
					formData: { email: loginValue },
					user: req.user || res.locals.user || null
				});
			}

			const minimalUser = {
				id: user.id || null,
				username: user.username,
				email: user.email,
				role: user.role || 'user'
			};

			try {
				if (req.session) {
					req.session.user = minimalUser;
				}
			} catch (sessErr) {
				console.warn('Session assignment failed:', sessErr);
			}

			req.user = minimalUser;
			res.locals.user = minimalUser;

			// determine redirect destination:
			// - use stored returnTo if set (from middleware), then clear it
			// - admins -> /inventory
			// - regular users -> /shopping
			let redirectTo = '/';
			if (req.session && req.session.returnTo) {
				redirectTo = req.session.returnTo;
				delete req.session.returnTo;
			} else if (minimalUser.role === 'admin') {
				redirectTo = '/inventory';
			} else {
				redirectTo = '/shopping';
			}

			return res.redirect(redirectTo);
		} catch (err) {
			console.error('Error during login:', err);
			return res.status(500).send('Internal Server Error');
		}
	},

	update: async function (req, res) {
		const id = req.params.id;
		try {
			const userData = {
				username: req.body.username || req.body.userName,
				email: req.body.email,
				password: req.body.password,
				address: req.body.address,
				contact: req.body.contact
				// role will be added below after validation
			};

			// Only set password if provided
			if (userData.password) {
				userData.password = await bcrypt.hash(userData.password, 10);
			}

			// Role sanitization: allow only 'admin' or 'user'.
			// Permit setting 'admin' only if requester is admin (req.user.role === 'admin').
			if (typeof req.body.role !== 'undefined') {
				if (req.body.role === 'admin') {
					if (req.user && req.user.role === 'admin') {
						userData.role = 'admin';
					} else {
						// requester not allowed to set admin — skip role change
					}
				} else {
					// any non-admin role is normalized to 'user'
					userData.role = 'user';
				}
			}

			const raw = await modelCall(UserModel.update.bind(UserModel), id, userData);
			const result = normalizeResult(raw) || raw;
			if (result && result.affectedRows === 0) return res.status(404).send('User not found');
			res.redirect('/');
		} catch (err) {
			console.error(`Error updating user ${id}:`, err);
			return res.status(500).send('Internal Server Error');
		}
	},

	delete: async function (req, res) {
		const id = req.params.id;
		try {
			const raw = await modelCall(UserModel.delete.bind(UserModel), id);
			const result = normalizeResult(raw) || raw;
			if (result && result.affectedRows === 0) return res.status(404).send('User not found');
			res.redirect('/');
		} catch (err) {
			console.error(`Error deleting user ${id}:`, err);
			return res.status(500).send('Internal Server Error');
		}
	}
};

module.exports = UserController;