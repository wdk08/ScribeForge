/** Used only at installation/restart, never on the typing path. */
export async function flushForUpdate({session,repository,backups}) {
  if (!session) throw new Error('Wait for the screenplay to finish opening.');
  await session.flush();
  await backups.queue;
  if (session.storageError || !session.recoveryCurrent) throw new Error('Recovery could not be saved. Keep ScriptForge open and resolve the storage warning.');
  if (session.fileError || (session.record.handle && session.dirty)) throw new Error('The linked Fountain file has unsaved changes or a save error. Save it or resolve the file warning before updating.');
  const stored=await repository.get(session.record.id);
  if (JSON.stringify(stored?.recovery?.document)!==JSON.stringify(session.document)) throw new Error('Recovery verification failed. Your screenplay remains open.');
}
