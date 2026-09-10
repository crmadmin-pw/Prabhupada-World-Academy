import './load_env';

import registerUser from '../src/api/registerUser';
import resolveUserLogin from '../src/api/resolveUserLogin';
import getUserProfile from '../src/api/getUserProfile';

async function runPwTest() {
  console.log('=== STARTING DIRECT ENDPOINT PW REGISTRATION TEST ===\n');

  const context = {
    user: {
      id: 'mock_pw_devotee_unique_id_999',
      email: 'pw-devotee@example.test',
      role: 'User',
    }
  };

  // 1. Check resolveUserLogin for unregistered user
  console.log('Starting call 1: resolveUserLogin...');
  const initialLogin = await (resolveUserLogin as any).execute({
    input: {},
    context,
  });
  console.log('1. Initial resolveUserLogin action (unregistered):', initialLogin.action);

  // 2. Register user
  console.log('Starting call 2: registerUser...');
  try {
    const regRes = await (registerUser as any).execute({
      input: {
        fullName: 'PW Testing Devotee',
        phoneCountryCode: '+91',
        phone: '9876543210',
        phoneE164: '+919876543210',
        email: 'pw-devotee@example.test',
        guideId: 'MENTOR-PW-ADMIN',
        residencyUserClaim: false,
        selectedFolkResidency: '',
        residencyJoinDate: '',
        ashrayLevel: 'Jigyasa',
        isPrabhupadaWorldUser: true,
      },
      context,
    });
    console.log('2. registerUser response:', regRes);
  } catch (e: any) {
    console.error('2. registerUser failed with error:', e.message);
  }

  // 3. Check resolveUserLogin after registration
  console.log('Starting call 3: resolveUserLogin...');
  const postRegLogin = await (resolveUserLogin as any).execute({
    input: {},
    context,
  });
  console.log('3. Post-registration resolveUserLogin action:', postRegLogin.action);
  console.log('   Post-registration resolved route:', postRegLogin.route);
  console.log('   Post-registration resolved status:', postRegLogin.user?.status);
  console.log('   Post-registration resolved segment:', postRegLogin.user?.segment);

  // 4. Get User Profile
  console.log('Starting call 4: getUserProfile...');
  const profileRes = await (getUserProfile as any).execute({
    input: {},
    context,
  });
  console.log('4. getUserProfile status:', profileRes.user?.status);
  console.log('   getUserProfile segment:', profileRes.user?.segment);
}

runPwTest().catch(console.error);
