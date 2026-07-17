import { z } from 'zod';
import { createEndpoint, Users, Guides, FolkResidencies, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Seeds Users table with real user data from PDF — Super Guide only',
  authenticated: true,
  inputSchema: z.object({ confirm: z.literal('SEED_USERS') }),
  outputSchema: z.object({
    usersUpserted: z.number(),
    status: z.string(),
  }),
  execute: async ({ input, context }: { input: any; context: any }) => {
    if (context.user!.role !== 'Super Guide') throw new ZiteError({ code: 'FORBIDDEN', message: 'Super Guide access required' });
    if (input.confirm !== 'SEED_USERS') throw new Error('Confirmation required');

    const usersData: Array<{
      userId: string;
      fullName: string;
      email: string;
      phone: string;
      role: string;
      status: string;
      ashrayLevel?: string;
      residencyClaimed?: boolean;
      residencyApproved?: boolean;
      residencyJoinDate?: string;
      isBvsl?: boolean;
      isSadhanaMentor?: boolean;
      bvServiceAllocated?: boolean;
      createdAt?: string;
      lastLoginAt?: string;
    }> = [
      { userId: 'USER-001', fullName: 'MTND', email: 'mtnd@hkmmumbai.org', phone: '7908563910', role: 'Guide', status: 'Active', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, createdAt: '2026-03-03T15:24:36Z', lastLoginAt: '2026-03-07T06:25:46.662Z' },
      { userId: 'USER-002', fullName: 'AGSD', email: 'asgd@hkmmumbai.org', phone: '9876543210', role: 'Guide', status: 'Active', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, createdAt: '2026-03-03T15:24:36Z' },
      { userId: 'USER-003', fullName: 'GMND', email: 'gmnd@hkmmumbai.org', phone: '9876543209', role: 'Guide', status: 'Active', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, createdAt: '2026-03-03T15:24:36Z' },
      { userId: 'USER-004', fullName: 'SHND', email: 'shnd@hkmmumbai.org', phone: '7908563910', role: 'Guide', status: 'Active', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, createdAt: '2026-03-03T15:24:36Z' },
      { userId: 'USER-005', fullName: 'HNMD', email: 'hnmd@hkmmumbai.org', phone: '9876543210', role: 'Guide', status: 'Active', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, createdAt: '2026-03-03T15:24:36Z' },
      { userId: 'USER-006', fullName: 'ANHD', email: 'anhd@hkmmumbai.org', phone: '9876543211', role: 'Guide', status: 'Active', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false },
      { userId: 'USER-008', fullName: 'test user', email: 'wiseprep.subs1@gmail.com', phone: '1234567890', role: 'Guide', status: 'Active', ashrayLevel: 'Upasaka', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2026-03-04', bvServiceAllocated: false, lastLoginAt: '2026-03-07T06:31:30.266Z' },
      { userId: 'USER-009', fullName: 'Tanay Anand', email: 'tanayanand447@gmail.com', phone: '9950456742', role: 'User', status: 'Active', ashrayLevel: 'Sevak', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false },
      { userId: 'USER-010', fullName: 'Indraneel Chakraborty', email: 'neelindra06@gmail.com', phone: '9833852361', role: 'User', status: 'Active', ashrayLevel: 'Jigyasa', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false },
      { userId: 'USER-011', fullName: 'Chetan Awasthi', email: 'awasthichetan098@gmail.com', phone: '7011201160', role: 'User', status: 'Active', ashrayLevel: 'Jigyasa', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false },
      { userId: 'USER-012', fullName: 'Saurav', email: 'sauravrawat28@gmail.com', phone: '8126202585', role: 'User', status: 'Active', ashrayLevel: 'Sevak', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false },
      { userId: 'USER-013', fullName: 'Sameer Kumar Epari', email: 'sameerepari@ymail.com', phone: '8147218313', role: 'User', status: 'Active', ashrayLevel: 'Sadhaka', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false },
      { userId: 'USER-015', fullName: 'Rajesh Saran', email: 'rajeshsaran199816@gmail.com', phone: '8208827961', role: 'User', status: 'Active', ashrayLevel: 'Shraddhavan', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false },
      { userId: 'USER-016', fullName: 'Gaurav Nagpal', email: 'elevatemind321@gmail.com', phone: '9582933971', role: 'Sadhana Mentor', status: 'Active', ashrayLevel: 'Sevak', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, isSadhanaMentor: true, lastLoginAt: '2026-03-06T03:26:22.301Z' },
      { userId: 'USER-017', fullName: 'Disha Aggarwal', email: 'geetanshbansal0338@gmail.com', phone: '7710480144', role: 'User', status: 'Active', ashrayLevel: 'Sevak', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false },
      { userId: 'USER-019', fullName: 'Vaibhav Srivastava', email: 'vaibhav2win@gmail.com', phone: '7800774575', role: 'User', status: 'Active', ashrayLevel: 'Shraddhavan', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false },
      { userId: 'USER-020', fullName: 'Samanyu Kasukurthi', email: 'samanyu@getnektar.com', phone: '6302315790', role: 'BVSL', status: 'Active', ashrayLevel: 'Sevak', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2026-03-04', bvServiceAllocated: false, isBvsl: true, lastLoginAt: '2026-03-07T06:28:03.810Z' },
      { userId: 'USER-021', fullName: 'Sunny Khobragade', email: 'sunnykhobragade23@gmail.com', phone: '7039659424', role: 'BVSL', status: 'Active', ashrayLevel: 'Sevak', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2025-03-04', bvServiceAllocated: false, isBvsl: true, lastLoginAt: '2026-03-04T08:43:37.168Z' },
      { userId: 'user_1773226826655_dqyebn0', fullName: 'testing last', email: 'yavoras913@devlug.com', phone: '546546879878', role: 'User', status: 'Active', ashrayLevel: 'Jigyasa', residencyClaimed: true, residencyApproved: false, residencyJoinDate: '2026-03-11', bvServiceAllocated: false, lastLoginAt: '2026-03-11T11:00:26.655Z' },
      { userId: 'user_1773305614630_vc0sm0a', fullName: 'test service', email: 'denis49579@indevgo.com', phone: '8888888888', role: 'User', status: 'Active', ashrayLevel: 'Sadhaka', residencyClaimed: true, residencyApproved: false, residencyJoinDate: '2026-03-12', bvServiceAllocated: false, lastLoginAt: '2026-03-12T08:53:34.630Z' },
      { userId: 'guide_1773308253696', fullName: 'MMKD', email: 'mmkd@hkmmumbai.org', phone: '9876543211', role: 'Guide', status: 'Active', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, createdAt: '2026-03-12T09:37:32.030Z', lastLoginAt: '2026-03-12T09:37:32.030Z' },
      { userId: 'user_1773339184614_j89ujdo', fullName: 'test serv', email: 'wotih35104@3dkai.com', phone: '11111111111111', role: 'BVSL', status: 'Active', ashrayLevel: 'Sadhaka', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2026-03-12', bvServiceAllocated: false, isBvsl: true, lastLoginAt: '2026-03-12T18:13:04.614Z' },
      { userId: 'user_1773368125980_xvz06qf', fullName: 'Yash Gaur', email: 'bh.yashgaur@gmail.com', phone: '9079865669', role: 'User', status: 'Active', ashrayLevel: 'Upasaka', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2025-12-01', bvServiceAllocated: false, lastLoginAt: '2026-03-13T02:15:25.980Z' },
      { userId: 'guide_1773368446769', fullName: 'SRGD', email: 'srgd@hkmmumbai.org', phone: '9876543210', role: 'Guide', status: 'Active', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, createdAt: '2026-03-13T02:20:44.989Z', lastLoginAt: '2026-03-13T02:20:44.989Z' },
      { userId: 'user_1773373197314_ucm9bj6', fullName: 'Aman Gupta', email: 'amanguptambm@gmail.com', phone: '7737952282', role: 'User', status: 'Active', ashrayLevel: 'Upasaka', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2023-08-01', bvServiceAllocated: false, lastLoginAt: '2026-03-13T03:39:57.314Z' },
      { userId: 'user_1773373564183_zxneaik', fullName: 'Madhushrava Bohra', email: 'theshyambohra@gmail.com', phone: '8890992800', role: 'Sadhana Mentor', status: 'Active', ashrayLevel: 'Sevak', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2025-01-04', bvServiceAllocated: false, isSadhanaMentor: true, lastLoginAt: '2026-03-13T03:46:04.183Z' },
      { userId: 'user_1773373844399_d7z8yvz', fullName: 'Rishi Mathur', email: 'rishirmathur71@gmail.com', phone: '9119219550', role: 'User', status: 'Active', ashrayLevel: 'Jigyasa', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2026-02-27', bvServiceAllocated: false, lastLoginAt: '2026-03-13T03:50:44.399Z' },
      { userId: 'user_1773373914512_d92f7g1', fullName: 'Kartikraj Nadar', email: 'kartikrajgeorge906@gmail.com', phone: '7977168570', role: 'User', status: 'Active', ashrayLevel: 'Jigyasa', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2026-02-17', bvServiceAllocated: false, lastLoginAt: '2026-03-13T03:51:54.512Z' },
      { userId: 'user_1773373959657_er67y4d', fullName: 'Parth Mittal', email: 'mittalparth20@gmail.com', phone: '9316421549', role: 'User', status: 'Active', ashrayLevel: 'Sadhaka', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2026-02-17', bvServiceAllocated: false, lastLoginAt: '2026-03-13T03:52:39.657Z' },
      { userId: 'user_1773375135170_33srmf4', fullName: 'Ayush Dodiya', email: 'ayushdodiya153@gmail.com', phone: '9106516099', role: 'User', status: 'Active', ashrayLevel: 'Upasaka', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2024-10-26', bvServiceAllocated: false, lastLoginAt: '2026-03-13T04:12:15.170Z' },
      { userId: 'user_1773375403299_sj514cu', fullName: 'AYUSH KUMAR KAMAL', email: 'abhay2ayushdsma@gmail.com', phone: '8882250261', role: 'User', status: 'Active', ashrayLevel: 'Shraddhavan', residencyClaimed: true, residencyApproved: true, bvServiceAllocated: false, lastLoginAt: '2026-03-13T04:16:43.299Z' },
      { userId: 'user_1773375417084_cc2jjpd', fullName: 'Himanshu Raj', email: 'hraj.g63@gmail.com', phone: '7061231021', role: 'User', status: 'Active', ashrayLevel: 'Sadhaka', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2024-08-05', bvServiceAllocated: false, lastLoginAt: '2026-03-13T04:16:57.084Z' },
      { userId: 'user_1773375486021_o3h7b8g', fullName: 'Divyansh Rathore', email: 'rathoredev021@gmail.com', phone: '9755570650', role: 'User', status: 'Active', ashrayLevel: 'Jigyasa', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2023-03-08', bvServiceAllocated: false, lastLoginAt: '2026-03-13T04:18:06.021Z' },
      { userId: 'user_1773375787383_9c9e0gm', fullName: 'Aman Prabhat Verma', email: 'verma.madhvan.verma@gmail.com', phone: '8299622905', role: 'User', status: 'Active', ashrayLevel: 'Jigyasa', residencyClaimed: true, residencyApproved: true, bvServiceAllocated: false, lastLoginAt: '2026-03-13T04:23:07.383Z' },
      { userId: 'guide_1773379263001', fullName: 'RMTD', email: 'rmtd@hkmmumbai.org', phone: '7908563910', role: 'Guide', status: 'Active', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, createdAt: '2026-03-13T05:21:01.722Z', lastLoginAt: '2026-03-13T05:21:01.722Z' },
      { userId: 'user_1773383048392_wzib5hn', fullName: 'Anand Sharma', email: 'anandaries988@gmail.com', phone: '9777454142', role: 'User', status: 'Active', ashrayLevel: 'Jigyasa', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2026-02-07', bvServiceAllocated: false, lastLoginAt: '2026-03-13T06:24:08.392Z' },
      { userId: 'user_1773383162211_ts82we3', fullName: 'Harshit Gupta', email: 'harshitgupta2211@gmail.com', phone: '9987735340', role: 'User', status: 'Active', ashrayLevel: 'Jigyasa', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2025-09-01', bvServiceAllocated: false, lastLoginAt: '2026-03-13T06:26:02.211Z' },
      { userId: 'user_1773389122740_riwznld', fullName: 'Samanyu Kasukurthi', email: 'samhkhr108@gmail.com', phone: '916302315790', role: 'User', status: 'Active', ashrayLevel: 'Shraddhavan', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2026-01-04', bvServiceAllocated: false, lastLoginAt: '2026-03-13T08:05:22.740Z' },
      { userId: 'user_1773498197289_ctsuypl', fullName: 'Gourav T.', email: 'gauravmanishtailor0@gmail.com', phone: '917073727480', role: 'User', status: 'Active', ashrayLevel: 'Jigyasa', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2026-03-01', bvServiceAllocated: false, lastLoginAt: '2026-03-14T14:23:17.289Z' },
      { userId: 'user_1773501139598_1etraqi', fullName: 'Samarth Charhate', email: 'charhatevishal1975@gmail.com', phone: '918669314423', role: 'User', status: 'Active', ashrayLevel: 'Jigyasa', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, lastLoginAt: '2026-03-14T15:12:19.598Z' },
      { userId: 'user_1773502315050_jg2b24d', fullName: 'Shrikant Walunjakar', email: 'shrikantwalunjakar108@gmail.com', phone: '919226109189', role: 'User', status: 'Active', ashrayLevel: 'Jigyasa', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, lastLoginAt: '2026-03-14T15:31:55.050Z' },
      { userId: 'user_1773502891645_jwdkl96', fullName: 'Tanay Anand', email: 'tanay345anand@gmail.com', phone: '919950456742', role: 'User', status: 'Active', ashrayLevel: 'Sevak', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, lastLoginAt: '2026-03-14T15:41:31.645Z' },
      { userId: 'user_1773670178015_g9wg1rr', fullName: 'Bandikatla Sai charan', email: 'bandikatlasaicharan@gmail.com', phone: '917893218688', role: 'User', status: 'Active', ashrayLevel: 'Sevak', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, lastLoginAt: '2026-03-16T14:09:38.015Z' },
      { userId: 'guide_1773675231563', fullName: 'TEST', email: 'marokay823@isfew.com', phone: '11111111111', role: 'Guide', status: 'Active', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, createdAt: '2026-03-16T15:33:50.107Z', lastLoginAt: '2026-03-16T15:33:50.107Z' },
      { userId: 'user_1773744417189_pi0uvzb', fullName: 'niraj jamkhandi', email: 'niraj.jamkhandi@gmail.com', phone: '918600933636', role: 'User', status: 'Active', ashrayLevel: 'Jigyasa', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, lastLoginAt: '2026-03-17T10:46:57.189Z' },
      { userId: 'user_1773757374700_qr1lipz', fullName: 'Abhijeet Singha', email: 'thabhijeet200@gmail.com', phone: '919864968173', role: 'User', status: 'Active', ashrayLevel: 'Jigyasa', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, lastLoginAt: '2026-03-17T14:22:54.700Z' },
      { userId: 'guide_1773819862215', fullName: 'GGUD', email: 'ggud@hkmmumbai.org', phone: '9619275108', role: 'Guide', status: 'Active', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, createdAt: '2026-03-18T07:44:20.303Z', lastLoginAt: '2026-03-18T07:44:20.303Z' },
      { userId: 'guide_1773819862919', fullName: 'URGD', email: 'urgd@hkmmumbai.org', phone: '9967800367', role: 'Guide', status: 'Active', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, createdAt: '2026-03-18T07:44:20.835Z', lastLoginAt: '2026-03-18T07:44:20.835Z' },
      { userId: 'user_1773820266857_wtrgniz', fullName: 'Dummy 7', email: 'mohnish21k@gmail.com', phone: '919876543210', role: 'User', status: 'Active', ashrayLevel: 'Caranashraya', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2026-03-18', bvServiceAllocated: false, lastLoginAt: '2026-03-18T07:51:06.857Z' },
      { userId: 'user_1773820308095_ywz96xb', fullName: 'Urukrama Gauranga Dasa', email: 'umeshpattar108@gmail.com', phone: '919967801234', role: 'User', status: 'Pending Approval', ashrayLevel: 'Sadhaka', residencyClaimed: true, residencyApproved: false, residencyJoinDate: '2026-03-18', bvServiceAllocated: false, lastLoginAt: '2026-03-18T07:51:48.095Z' },
      { userId: 'user_1773820335840_5nayjcw', fullName: 'Gopal Rastogi', email: 'gopalrastogi.mmmec@gmail.com', phone: '919619266666', role: 'User', status: 'Pending Approval', ashrayLevel: 'Shraddhavan', residencyClaimed: true, residencyApproved: false, residencyJoinDate: '2026-02-05', bvServiceAllocated: false, lastLoginAt: '2026-03-18T07:52:15.840Z' },
      { userId: 'user_1773820477464_cwn4c34', fullName: 'Folk Powai', email: 'folk.powai@gmail.com', phone: '919967800542', role: 'User', status: 'Active', ashrayLevel: 'Caranashraya', residencyClaimed: true, residencyApproved: true, residencyJoinDate: '2024-03-18', bvServiceAllocated: false, lastLoginAt: '2026-03-18T07:54:37.464Z' },
      { userId: 'user_1773838171122_xqdqk83', fullName: 'Ayush Vijayvargia', email: 'imaayush29@gmail.com', phone: '918769814149', role: 'User', status: 'Pending Approval', ashrayLevel: 'Shraddhavan', residencyClaimed: false, residencyApproved: false, bvServiceAllocated: false, lastLoginAt: '2026-03-18T12:49:31.122Z' },
    ];

    // Clear and Seed FolkResidencies and Guides tables
    const [existingRes, existingGuides] = await Promise.all([
      FolkResidencies.findAll({}),
      Guides.findAll({}),
    ]);
    await Promise.all([
      ...existingRes.records.map((r: any) => FolkResidencies.delete({ id: r.id })),
      ...existingGuides.records.map((g: any) => Guides.delete({ id: g.id })),
    ]);

    const residencies = [
      { id: 'res_powai', residencyId: 'res_powai', residencyName: 'Folk Powai', maxCapacity: 20, isActive: true },
      { id: 'res_mulund', residencyId: 'res_mulund', residencyName: 'Folk Mulund', maxCapacity: 15, isActive: true },
      { id: 'res_thane', residencyId: 'res_thane', residencyName: 'Folk Thane', maxCapacity: 15, isActive: true },
      { id: 'res_chembur', residencyId: 'res_chembur', residencyName: 'Folk Chembur', maxCapacity: 10, isActive: true },
    ];
    await FolkResidencies.bulkCreate({ records: residencies, matchOn: ['id'] });

    const guidesToCreate = usersData
      .filter(u => u.role === 'Guide')
      .map(u => ({
        id: u.userId,
        guideId: u.userId,
        fullName: u.fullName,
        email: u.email,
        phone: u.phone,
        abbreviation: u.fullName,
        isActive: true,
        folkResidencies: JSON.stringify(['res_powai', 'res_mulund', 'res_thane', 'res_chembur']),
        users: JSON.stringify([]),
      }));
    await Guides.bulkCreate({ records: guidesToCreate, matchOn: ['id'] });

    // Process in batches of 50 to stay within rate limits
    const batchSize = 50;
    let totalUpserted = 0;

    const resIds = ['res_powai', 'res_mulund', 'res_thane', 'res_chembur'];

    for (let i = 0; i < usersData.length; i += batchSize) {
      const batch = usersData.slice(i, i + batchSize);
      const records = batch.map(u => {
        let assignedRes: string | undefined;
        if (u.residencyClaimed) {
          assignedRes = resIds[u.fullName.length % resIds.length];
        }

        let assignedGuide: string | undefined;
        if (u.role === 'User') {
          assignedGuide = 'USER-001'; // Default user's guide to MTND (USER-001)
        }

        return {
          userId: u.userId,
          fullName: u.fullName,
          email: u.email,
          phone: u.phone,
          role: u.role as any,
          status: u.status as any,
          ...(u.ashrayLevel ? { ashrayLevel: u.ashrayLevel as any } : {}),
          residencyClaimed: u.residencyClaimed ?? false,
          residencyApproved: u.residencyApproved ?? false,
          ...(u.residencyJoinDate ? { residencyJoinDate: u.residencyJoinDate } : {}),
          ...(assignedRes ? { residency: assignedRes } : {}),
          ...(assignedGuide ? { guide: assignedGuide } : {}),
          isBvsl: u.isBvsl ?? false,
          isSadhanaMentor: u.isSadhanaMentor ?? false,
          bvServiceAllocated: u.bvServiceAllocated ?? false,
          ...(u.createdAt ? { createdAt: u.createdAt } : {}),
          ...(u.lastLoginAt ? { lastLoginAt: u.lastLoginAt } : {}),
        };
      });

      const result = await Users.bulkCreate({ records, matchOn: ['userId'] });
      totalUpserted += result.records.length;
    }

    return {
      usersUpserted: totalUpserted,
      status: `Successfully upserted ${totalUpserted} users!`,
    };
  },
});
