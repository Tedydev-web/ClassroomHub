import { BaseApiWithErrors, classroomhub } from '$lib/utils/services/api';
import { mediaApi } from '$features/media/api';
import type {
  AttachScormPackageRequest,
  CreateScormSourceUploadRequest,
  DeleteScormPackageRequest,
  GetScormPackageRequest,
  ImportScormPackageRequest,
  ListScormPackagesRequest,
  ListScormReportsRequest,
  ScormPackage,
  ScormPackageDetail,
  ScormReports
} from '../utils/types';

class ScormAdminApi extends BaseApiWithErrors {
  packages = $state<ScormPackage[]>([]);
  reports = $state<ScormReports | null>(null);
  reportsLoading = $state(false);

  listPackages() {
    return this.execute<ListScormPackagesRequest>({
      requestFn: () => classroomhub.organization.scorm.packages.$get(),
      logContext: 'fetching SCORM packages',
      onSuccess: (response) => {
        this.packages = response.data;
      }
    });
  }

  async getPackage(packageId: string): Promise<ScormPackageDetail | null> {
    const response = await this.execute<GetScormPackageRequest>({
      requestFn: () => classroomhub.organization.scorm.packages[':packageId'].$get({ param: { packageId } }),
      logContext: 'fetching SCORM package'
    });

    return response?.data ?? null;
  }

  async upload(file: File, title: string) {
    const fileType =
      file.type === 'application/zip' || file.type === 'application/x-zip-compressed'
        ? file.type
        : 'application/octet-stream';
    const source = await this.execute<CreateScormSourceUploadRequest>({
      requestFn: () =>
        classroomhub.organization.scorm.packages['source-upload'].$post({
          json: { fileName: file.name, fileSize: file.size, fileType }
        }),
      logContext: 'creating SCORM source upload'
    });
    if (!source) return null;

    const uploadResponse = await fetch(source.data.url, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': fileType }
    });
    if (!uploadResponse.ok) {
      this.error = `SCORM upload failed with status ${uploadResponse.status}`;
      return null;
    }

    const asset = await mediaApi.createAsset({
      kind: 'document',
      provider: 'upload',
      storageProvider: 's3',
      storageKey: source.data.fileKey,
      sourceUrl: source.data.url,
      mimeType: fileType,
      byteSize: file.size,
      title,
      isExternal: false,
      metadata: { fileName: file.name, createdAt: new Date().toISOString(), purpose: 'scorm_source' }
    });
    if (!asset) return null;

    const imported = await this.execute<ImportScormPackageRequest>({
      requestFn: () => classroomhub.organization.scorm.packages.$post({ json: { assetId: asset.id, title } }),
      logContext: 'importing SCORM package',
      onSuccess: (response) => {
        this.packages = [response.data.package, ...this.packages];
      }
    });

    return imported?.data ?? null;
  }

  remove(packageId: string) {
    return this.execute<DeleteScormPackageRequest>({
      requestFn: () => classroomhub.organization.scorm.packages[':packageId'].$delete({ param: { packageId } }),
      logContext: 'deleting SCORM package',
      onSuccess: () => {
        this.packages = this.packages.filter((item) => item.id !== packageId);
      }
    });
  }

  attach(packageId: string, courseId: string, lessonId: string, packageItemId: string) {
    return this.execute<AttachScormPackageRequest>({
      requestFn: () =>
        classroomhub.organization.scorm.packages[':packageId'].attach.$post({
          param: { packageId },
          json: { courseId, lessonId, packageItemId }
        }),
      logContext: 'attaching SCORM package'
    });
  }

  async listReports(page = 1) {
    this.reportsLoading = true;
    const response = await this.execute<ListScormReportsRequest>({
      requestFn: () => classroomhub.organization.scorm.reports.$get({ query: { page: String(page), limit: '20' } }),
      logContext: 'fetching SCORM reports',
      onSuccess: (response) => {
        this.reports = response.data;
      }
    });
    this.reportsLoading = false;

    return response;
  }
}

export const scormAdminApi = new ScormAdminApi();
