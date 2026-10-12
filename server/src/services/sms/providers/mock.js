export const mockProvider = {
  name: 'mock',
  label: 'Mock (development)',
  isReady: () => true,
  async send({ to, message }) {
    const id = `MOCK-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[sms:mock] -> ${to}: ${message}`);
    return { id, simulated: true };
  },
};
