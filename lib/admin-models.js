import connectAdminDB from './mongodb-admin';
import SuperAdminSchema from '@/models/admin/SuperAdmin';
import ExportSchema from '@/models/admin/Export';
import AdminLogSchema from '@/models/admin/AdminLog';

let SuperAdmin, Export, AdminLog;

export async function getAdminModels() {
  const adminConn = await connectAdminDB();

  if (!SuperAdmin) {
    SuperAdmin = adminConn.model('SuperAdmin', SuperAdminSchema);
  }
  if (!Export) {
    Export = adminConn.model('Export', ExportSchema);
  }
  if (!AdminLog) {
    AdminLog = adminConn.model('AdminLog', AdminLogSchema);
  }

  return { SuperAdmin, Export, AdminLog };
}

export { SuperAdmin, Export, AdminLog };
