import { FastifyInstance } from 'fastify';
import { requireRole } from '../middlewares/rbac.js';
import { bookingSchema, idParam, parseOrThrow, slotCreateSchema, slotListQuery } from '../utils/validator.js';
import { nameOnlyUserSelect } from '../lib/serializers.js';
import { findStudentByUser } from '../lib/students.js';
import { sendBookingConfirmation } from '../services/email.js';

const slotInclude = { mentor: { include: { user: { select: nameOnlyUserSelect } } } } as const;
const mentorOnly = (f: FastifyInstance) => ({ preHandler: [f.authenticate, requireRole('MENTOR')] });

export default async function bookingRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;

  // ----- Mentor: publish availability -----
  fastify.post('/mentor/slots', mentorOnly(fastify), async (req, reply) => {
    const { startTime, endTime } = parseOrThrow(slotCreateSchema, req.body);
    if (startTime <= new Date()) return reply.code(400).send({ error: 'startTime must be in the future' });
    const mentor = await prisma.mentor.findUnique({ where: { userId: req.currentUser!.id }, select: { id: true } });
    if (!mentor) return reply.code(404).send({ error: 'Mentor profile not found' });

    const overlap = await prisma.mentorSlot.findFirst({
      where: { mentorId: mentor.id, status: { not: 'CANCELLED' }, startTime: { lt: endTime }, endTime: { gt: startTime } },
      select: { id: true },
    });
    if (overlap) return reply.code(409).send({ error: 'This overlaps one of your existing slots' });
    reply.code(201).send(await prisma.mentorSlot.create({ data: { mentorId: mentor.id, startTime, endTime } }));
  });

  // ----- Mentor: own slots, with who booked them -----
  fastify.get('/mentor/slots', mentorOnly(fastify), async (req, reply) => {
    const mentor = await prisma.mentor.findUnique({ where: { userId: req.currentUser!.id }, select: { id: true } });
    if (!mentor) return reply.code(404).send({ error: 'Mentor profile not found' });
    reply.send(
      await prisma.mentorSlot.findMany({
        where: { mentorId: mentor.id, status: { not: 'CANCELLED' } },
        include: { booking: { select: { id: true, notes: true, student: { select: { rollNumber: true, user: { select: nameOnlyUserSelect } } } } } },
        orderBy: { startTime: 'asc' },
      })
    );
  });

  // ----- Mentor: withdraw an unbooked slot -----
  fastify.delete('/mentor/slots/:id', mentorOnly(fastify), async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    const slot = await prisma.mentorSlot.findUnique({ where: { id }, include: { mentor: { select: { userId: true } } } });
    if (!slot || slot.mentor.userId !== req.currentUser!.id) return reply.code(404).send({ error: 'Slot not found' });
    if (slot.status === 'BOOKED') return reply.code(409).send({ error: 'This slot is booked; ask the student to cancel first' });
    await prisma.mentorSlot.update({ where: { id }, data: { status: 'CANCELLED' } });
    reply.code(204).send();
  });

  // ----- Anyone logged in: browse open, future slots -----
  fastify.get('/slots', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { mentorId } = parseOrThrow(slotListQuery, req.query);
    reply.send(
      await prisma.mentorSlot.findMany({
        where: { status: 'AVAILABLE', startTime: { gt: new Date() }, ...(mentorId ? { mentorId } : {}) },
        include: slotInclude,
        orderBy: { startTime: 'asc' },
      })
    );
  });

  // ----- Student: book a slot (atomic; two students can never get the same slot) -----
  fastify.post('/book', { preHandler: fastify.authenticate }, async (req, reply) => {
    const body = parseOrThrow(bookingSchema, req.body);
    const me = await findStudentByUser(prisma, req.currentUser!.id);
    if (!me) return reply.code(403).send({ error: 'Only students can book mentor sessions' });

    const booking = await prisma.$transaction(async (tx) => {
      // Conditional UPDATE: only one concurrent transaction can flip AVAILABLE → BOOKED.
      const claimed = await tx.mentorSlot.updateMany({
        where: { id: body.slotId, status: 'AVAILABLE', startTime: { gt: new Date() } },
        data: { status: 'BOOKED' },
      });
      if (claimed.count === 0) throw Object.assign(new Error('Slot no longer available'), { statusCode: 409 });
      return tx.booking.create({
        data: { slotId: body.slotId, studentId: me.id, notes: body.notes },
        include: { slot: { include: slotInclude } },
      });
    });

    // The booking is committed. A mail failure must NOT turn a successful booking into an error response.
    let emailSent = false;
    try {
      const m = booking.slot.mentor.user;
      await sendBookingConfirmation(req.currentUser!.email, `${m.firstName} ${m.lastName}`, booking.slot.startTime);
      emailSent = true;
    } catch (err) {
      req.log.error(err);
    }
    reply.code(201).send({ ...booking, emailSent });
  });

  // ----- Student: own bookings -----
  fastify.get('/mine', { preHandler: fastify.authenticate }, async (req, reply) => {
    const me = await findStudentByUser(prisma, req.currentUser!.id);
    if (!me) return reply.code(404).send({ error: 'Student profile not found' });
    reply.send(await prisma.booking.findMany({ where: { studentId: me.id }, include: { slot: { include: slotInclude } }, orderBy: { createdAt: 'desc' } }));
  });

  // ----- Student (owner) or officer/admin: cancel a booking and free the slot -----
  fastify.delete('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = parseOrThrow(idParam, req.params);
    const user = req.currentUser!;
    const booking = await prisma.booking.findUnique({ where: { id }, include: { student: { select: { userId: true } }, slot: true } });
    if (!booking) return reply.code(404).send({ error: 'Booking not found' });
    const privileged = user.role === 'TPC_OFFICER' || user.role === 'ADMIN';
    // Not the owner → respond 404 (not 403) so booking ids can't be probed.
    if (!privileged && booking.student.userId !== user.id) return reply.code(404).send({ error: 'Booking not found' });

    await prisma.$transaction([
      prisma.booking.delete({ where: { id } }),
      prisma.mentorSlot.update({ where: { id: booking.slotId }, data: { status: booking.slot.startTime > new Date() ? 'AVAILABLE' : 'CANCELLED' } }),
    ]);
    reply.code(204).send();
  });
}
