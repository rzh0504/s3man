interface TransferController {
  cancel: () => Promise<void>;
  pause?: () => Promise<void>;
  resume?: () => Promise<void>;
}

const controllers = new Map<string, TransferController>();

export function registerTransferController(id: string, controller: TransferController): void {
  controllers.set(id, controller);
}

export function unregisterTransferController(id: string): void {
  controllers.delete(id);
}

export async function cancelRegisteredTransfer(id: string): Promise<boolean> {
  const controller = controllers.get(id);
  if (!controller) return false;
  await controller.cancel();
  controllers.delete(id);
  return true;
}

export async function pauseRegisteredTransfer(id: string): Promise<boolean> {
  const controller = controllers.get(id);
  if (!controller?.pause) return false;
  await controller.pause();
  return true;
}

export async function resumeRegisteredTransfer(id: string): Promise<boolean> {
  const controller = controllers.get(id);
  if (!controller?.resume) return false;
  await controller.resume();
  return true;
}
