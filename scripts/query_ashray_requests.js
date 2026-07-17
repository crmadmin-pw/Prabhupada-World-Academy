const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

initializeApp({
  projectId: 'prabhupada-world-academy'
});

const db = getFirestore();

async function run() {
  const usersSnapshot = await db.collection('Users').get();
  console.log(`Total users: ${usersSnapshot.size}`);
  usersSnapshot.forEach(doc => {
    const data = doc.data();
    if (data.guide) {
      console.log(`User: ${doc.id} | Name: ${data.fullName} | Guide:`, JSON.stringify(data.guide));
    }
  });
}

run().catch(console.error);
