import { DefaultCognitionAuthorityService } from './cognition.js';
import { DefaultSiteProfileAuthorityService } from './site-profile.js';
import {
  DefaultMetadataFieldOwnerService,
  type MetadataFieldOwnerService,
  type P2EMetadataFieldOwnerService,
} from './metadata.js';
import { ExplicitAuthorityCommandBoundary, type AuthorityCommandPolicy } from './commands.js';
import type { AuthorityStorage } from './storage.js';

/** Privileged composition entry. Never imported by ordinary application callers. */
export function createAuthorityServices(storage: AuthorityStorage, commandPolicy: AuthorityCommandPolicy) {
  return Object.freeze({
    cognition: new DefaultCognitionAuthorityService(storage),
    sites: new DefaultSiteProfileAuthorityService(storage),
    metadata: Object.freeze({
      request: new DefaultMetadataFieldOwnerService(storage, 'request') as Pick<MetadataFieldOwnerService<'request'>, 'read'>,
      workerResult: new DefaultMetadataFieldOwnerService(storage, 'workerResult') as MetadataFieldOwnerService<'workerResult'>,
      p2e: new DefaultMetadataFieldOwnerService(storage, 'p2e') as P2EMetadataFieldOwnerService,
      cognition: new DefaultMetadataFieldOwnerService(storage, 'cognition') as MetadataFieldOwnerService<'cognition'>,
      siteProfile: new DefaultMetadataFieldOwnerService(storage, 'siteProfile') as MetadataFieldOwnerService<'siteProfile'>,
    }),
    commands: new ExplicitAuthorityCommandBoundary(commandPolicy),
  });
}
