import { getAdminModels } from './admin-models';
import Society from '@/models/Society';

/**
 * Export deleted data to admin.exports collection
 * This is the MAIN function called before any deletion
 */
export async function exportToAdminDB(data, metadata) {
  const {
    collection,
    societyId,
    deletedBy,
    deletedByName,
    deletedByRole,
    deletionReason,
  } = metadata;

  try {
    const { Export } = await getAdminModels();

    // Get society name
    const society = await Society.findById(societyId).lean();
    const societyName = society?.name || 'Unknown Society';

    // Calculate statistics
    let totalValue = 0;
    if (collection === 'bills') {
      totalValue = data.reduce((sum, bill) => sum + (bill.totalAmount || 0), 0);
    } else if (collection === 'transactions') {
      totalValue = data.reduce((sum, txn) => sum + (txn.amount || 0), 0);
    }

    // Create export entry
    const exportEntry = await Export.create({
 collectionName: collection,  
       societyId,
      societyName,
      deletedAt: new Date(),
      deletedBy: {
        userId: deletedBy,
        userName: deletedByName,
        userRole: deletedByRole,
      },
      deletionReason,
      data: data, // Full data copy
      recordCount: data.length,
      totalValue,
      isRestored: false,
      willExpireAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
    });

    console.log(`✅ Exported ${data.length} ${collection} records to admin.exports`);
    console.log(`   Society: ${societyName}`);
    console.log(`   Export ID: ${exportEntry._id}`);

    return {
      success: true,
      exportId: exportEntry._id,
      recordCount: data.length,
      collection,
    };
  } catch (error) {
    console.error('❌ Export to admin DB failed:', error);
    throw error;
  }
}

/**
 * Log admin activity
 */
export async function logAdminActivity(activityData) {
  try {
    const { AdminLog } = await getAdminModels();

    await AdminLog.create({
      adminId: activityData.adminId,
      adminName: activityData.adminName,
      action: activityData.action,
      targetSociety: activityData.targetSociety,
      details: activityData.details,
      ipAddress: activityData.ipAddress,
      userAgent: activityData.userAgent,
      timestamp: new Date(),
    });

    console.log(`📝 Logged admin action: ${activityData.action}`);
  } catch (error) {
    console.error('❌ Failed to log admin activity:', error);
  }
}
