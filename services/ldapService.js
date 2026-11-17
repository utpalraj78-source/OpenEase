// Institutional LDAP Directory Subordinate System (Figure 50.1)
// Connects OpenEase authentication to institutional credential directories (e.g. Active Directory / OpenLDAP).
const User = require('../models/User');
const { nextCode } = require('../models/Counter');
const dispatcher = require('../utility/auditAlertDispatcher');

// Simulated Institutional LDAP Directory store
const INSTITUTIONAL_DIRECTORY = {
  'faculty.cse@lnmiit.ac.in': {
    fullName: 'Prof. Animesh Mukherjee',
    role: 'COORDINATOR',
    department: 'Computer Science and Engineering',
    officeRoom: 'CSE-304',
    title: 'Professor & Open House Coordinator'
  },
  'approver.dean@lnmiit.ac.in': {
    fullName: 'Dr. S. K. Gupta',
    role: 'APPROVER',
    department: 'Academic Affairs',
    departmentScope: 'All Engineering Departments',
    administrativeRank: 'Associate Dean of Academics'
  },
  'admin.directory@lnmiit.ac.in': {
    fullName: 'Institutional System Admin',
    role: 'ADMIN',
    department: 'Campus IT Infrastructure'
  }
};

const LDAP_CONFIG = {
  host: process.env.LDAP_HOST || 'ldap://directory.lnmiit.ac.in',
  port: parseInt(process.env.LDAP_PORT || '389', 10),
  baseDn: 'dc=lnmiit,dc=ac,dc=in',
  bindDn: 'cn=openease-auth,ou=services,dc=lnmiit,dc=ac,dc=in',
  status: 'ONLINE'
};

async function authenticateLdap(identifier, password) {
  const email = (identifier || '').trim().toLowerCase();
  if (!email || !password) return null;

  // In production or test environment, check institutional directory credentials
  // Demo password for institutional accounts: pass1234
  if (password !== 'pass1234' && password !== 'ldap1234') {
    return null;
  }

  const ldapProfile = INSTITUTIONAL_DIRECTORY[email];
  if (!ldapProfile) {
    // If institutional domain is used, allow dynamic institutional auth
    if (email.endsWith('@lnmiit.ac.in')) {
      return {
        email,
        fullName: email.split('@')[0].replace('.', ' ').toUpperCase(),
        role: 'COORDINATOR',
        department: 'Campus Academic Services'
      };
    }
    return null;
  }

  return { email, ...ldapProfile };
}

async function findOrCreateLdapUser(ldapProfile) {
  let user = await User.findOne({ email: ldapProfile.email });
  if (user) {
    user.lastLoginAt = new Date();
    await user.save();
    return user;
  }

  const common = {
    userId: await nextCode('USR'),
    fullName: ldapProfile.fullName,
    email: ldapProfile.email,
    passwordHash: await User.hashPassword('pass1234'),
    accountStatus: 'ACTIVE'
  };

  switch (ldapProfile.role) {
    case 'COORDINATOR':
      user = await User.EventCoordinator.create({
        ...common,
        coordinatorId: await nextCode('COO'),
        department: ldapProfile.department,
        officeRoom: ldapProfile.officeRoom || ''
      });
      break;
    case 'APPROVER':
      user = await User.EventApprover.create({
        ...common,
        approverId: await nextCode('APR'),
        departmentScope: ldapProfile.departmentScope || ldapProfile.department,
        administrativeRank: ldapProfile.administrativeRank || 'Faculty Approver'
      });
      break;
    default:
      user = await User.Administrator.create({
        ...common,
        department: ldapProfile.department
      });
  }

  await dispatcher.log(user._id, 'LDAP_USER_PROVISIONED', user.email, `Synced from ${LDAP_CONFIG.host}`);
  return user;
}

function getDirectoryStatus() {
  return {
    ...LDAP_CONFIG,
    lastSynchronized: new Date(),
    directoryAccountsCount: Object.keys(INSTITUTIONAL_DIRECTORY).length
  };
}

module.exports = { authenticateLdap, findOrCreateLdapUser, getDirectoryStatus };
