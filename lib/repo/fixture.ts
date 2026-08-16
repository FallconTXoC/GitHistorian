import type {
  Commit,
  DiffHunk,
  FileChange,
  ModuleDef,
  RepoModel,
} from './types'

// --- diff authoring helpers -----------------------------------------------

function hunk(header: string, raw: string[]): DiffHunk {
  return {
    header,
    lines: raw.map((r) => {
      const t = r[0]
      return {
        type: t === '+' ? 'add' : t === '-' ? 'del' : 'context',
        text: r.slice(1),
      }
    }),
  }
}

function change(
  path: string,
  status: FileChange['status'],
  additions: number,
  deletions: number,
  hunks: DiffHunk[],
  from?: string,
): FileChange {
  return { path, status, additions, deletions, hunks, from }
}

// --- modules (drive the spatial layout of the map) -------------------------

const modules: ModuleDef[] = [
  { id: 'api', label: 'API', prefix: 'src/api/', layer: 0, column: 0 },
  { id: 'services', label: 'Services', prefix: 'src/services/', layer: 1, column: 0 },
  { id: 'utils', label: 'Utilities', prefix: 'src/utils/', layer: 1, column: 1 },
  { id: 'domain', label: 'Domain', prefix: 'src/domain/', layer: 2, column: 0 },
  { id: 'repositories', label: 'Repositories', prefix: 'src/repositories/', layer: 2, column: 1 },
  { id: 'database', label: 'Database', prefix: 'src/database/', layer: 3, column: 0 },
  { id: 'tests', label: 'Tests', prefix: 'tests/', layer: 3, column: 1 },
]

// --- commit history --------------------------------------------------------
// One clean divergence point (e5f6a7b) feeds three branches:
//   main             → validation → logging → token fix
//   refactor         → repository interfaces → move db access → slim service
//   feature/payments → payment domain → payment service → checkout wiring

const commits: Commit[] = [
  {
    sha: 'a1b2c3d',
    message: 'Scaffold project and HTTP server',
    author: 'Dana Ruiz',
    timestamp: '2025-11-04T09:12:00Z',
    branch: 'main',
    parents: [],
    changes: [
      change('src/api/server.ts', 'added', 34, 0, [
        hunk('@@ -0,0 +1,12 @@', [
          '+import { createRouter } from "./routes"',
          '+',
          '+export function startServer(port: number) {',
          '+  const router = createRouter()',
          '+  return listen(port, router)',
          '+}',
        ]),
      ]),
      change('src/utils/logger.ts', 'added', 21, 0, [
        hunk('@@ -0,0 +1,9 @@', [
          '+export const logger = {',
          '+  info: (msg: string) => console.log("[info]", msg),',
          '+  error: (msg: string) => console.error("[error]", msg),',
          '+}',
        ]),
      ]),
      change('src/database/connection.ts', 'added', 26, 0, [
        hunk('@@ -0,0 +1,10 @@', [
          '+let pool: Pool',
          '+export function db() {',
          '+  if (!pool) pool = createPool(process.env.DATABASE_URL)',
          '+  return pool',
          '+}',
        ]),
      ]),
    ],
  },
  {
    sha: 'b2c3d4e',
    message: 'Add user domain and database connection',
    author: 'Dana Ruiz',
    timestamp: '2025-11-12T14:40:00Z',
    branch: 'main',
    parents: ['a1b2c3d'],
    changes: [
      change('src/domain/User.ts', 'added', 18, 0, [
        hunk('@@ -0,0 +1,8 @@', [
          '+export interface User {',
          '+  id: string',
          '+  email: string',
          '+  passwordHash: string',
          '+}',
        ]),
      ]),
      change('src/repositories/UserRepository.ts', 'added', 40, 0, [
        hunk('@@ -0,0 +1,14 @@', [
          '+import { db } from "../database/connection"',
          '+import type { User } from "../domain/User"',
          '+',
          '+export async function findById(id: string): Promise<User> {',
          '+  return db().query("select * from users where id = $1", [id])',
          '+}',
        ]),
      ]),
      change('src/database/migrations.ts', 'added', 22, 0, [
        hunk('@@ -0,0 +1,9 @@', [
          '+import { db } from "./connection"',
          '+export async function migrate() {',
          '+  await db().query("create table users (...)")',
          '+}',
        ]),
      ]),
      change('src/database/connection.ts', 'modified', 6, 1, [
        hunk('@@ -3,4 +3,9 @@', [
          ' export function db() {',
          '-  if (!pool) pool = createPool(process.env.DATABASE_URL)',
          '+  if (!pool) pool = createPool(process.env.DATABASE_URL, { max: 10 })',
          '   return pool',
          ' }',
        ]),
      ]),
    ],
  },
  {
    sha: 'c3d4e5f',
    message: 'Add authentication service and tokens',
    author: 'Priya Shah',
    timestamp: '2025-11-25T11:05:00Z',
    branch: 'main',
    parents: ['b2c3d4e'],
    changes: [
      change('src/utils/tokens.ts', 'added', 30, 0, [
        hunk('@@ -0,0 +1,11 @@', [
          '+import { logger } from "./logger"',
          '+export function sign(id: string) {',
          '+  logger.info("issuing token")',
          '+  return jwt.sign({ id }, secret, { expiresIn: "1h" })',
          '+}',
        ]),
      ]),
      change('src/services/AuthService.ts', 'added', 44, 0, [
        hunk('@@ -0,0 +1,16 @@', [
          '+import * as users from "../repositories/UserRepository"',
          '+import { sign } from "../utils/tokens"',
          '+',
          '+export async function login(email: string, password: string) {',
          '+  const user = await users.findByEmail(email)',
          '+  return sign(user.id)',
          '+}',
        ]),
      ]),
      change('src/services/UserService.ts', 'added', 38, 0, [
        hunk('@@ -0,0 +1,15 @@', [
          '+import * as users from "../repositories/UserRepository"',
          '+import * as auth from "./AuthService"',
          '+import type { User } from "../domain/User"',
          '+',
          '+export async function register(email: string, password: string) {',
          '+  const user = await users.create({ email, password })',
          '+  return user',
          '+}',
        ]),
      ]),
    ],
  },
  {
    sha: 'd4e5f6a',
    message: 'Add order service and domain',
    author: 'Dana Ruiz',
    timestamp: '2025-12-10T16:22:00Z',
    branch: 'main',
    parents: ['c3d4e5f'],
    changes: [
      change('src/domain/Order.ts', 'added', 20, 0, [
        hunk('@@ -0,0 +1,9 @@', [
          '+export interface Order {',
          '+  id: string',
          '+  userId: string',
          '+  total: number',
          '+  status: "pending" | "paid"',
          '+}',
        ]),
      ]),
      change('src/repositories/OrderRepository.ts', 'added', 42, 0, [
        hunk('@@ -0,0 +1,15 @@', [
          '+import { db } from "../database/connection"',
          '+import type { Order } from "../domain/Order"',
          '+export async function save(order: Order) {',
          '+  return db().query("insert into orders ...", [order])',
          '+}',
        ]),
      ]),
      change('src/services/OrderService.ts', 'added', 48, 0, [
        hunk('@@ -0,0 +1,17 @@', [
          '+import * as orders from "../repositories/OrderRepository"',
          '+import type { Order } from "../domain/Order"',
          '+',
          '+export async function placeOrder(userId: string, total: number) {',
          '+  const order = { id: uuid(), userId, total, status: "pending" }',
          '+  await orders.save(order)',
          '+  return order',
          '+}',
        ]),
      ]),
    ],
  },
  {
    sha: 'e5f6a7b',
    message: 'Expose REST API controllers and routes',
    author: 'Priya Shah',
    timestamp: '2026-01-08T10:30:00Z',
    branch: 'main',
    parents: ['d4e5f6a'],
    changes: [
      change('src/api/routes.ts', 'added', 30, 0, [
        hunk('@@ -0,0 +1,12 @@', [
          '+import { UserController } from "./UserController"',
          '+import { OrderController } from "./OrderController"',
          '+import { AuthController } from "./AuthController"',
          '+export function createRouter() {',
          '+  return route("/users", UserController)',
          '+}',
        ]),
      ]),
      change('src/api/UserController.ts', 'added', 36, 0, [
        hunk('@@ -0,0 +1,14 @@', [
          '+import * as service from "../services/UserService"',
          '+import { validate } from "../utils/validation"',
          '+export const UserController = {',
          '+  create: async (req) => service.register(req.body.email, req.body.password),',
          '+}',
        ]),
      ]),
      change('src/api/OrderController.ts', 'added', 34, 0, [
        hunk('@@ -0,0 +1,13 @@', [
          '+import * as service from "../services/OrderService"',
          '+import { validate } from "../utils/validation"',
          '+export const OrderController = {',
          '+  create: async (req) => service.placeOrder(req.user.id, req.body.total),',
          '+}',
        ]),
      ]),
      change('src/api/AuthController.ts', 'added', 24, 0, [
        hunk('@@ -0,0 +1,10 @@', [
          '+import * as service from "../services/AuthService"',
          '+export const AuthController = {',
          '+  login: async (req) => service.login(req.body.email, req.body.password),',
          '+}',
        ]),
      ]),
      change('src/utils/validation.ts', 'added', 19, 0, [
        hunk('@@ -0,0 +1,8 @@', [
          '+export function validate(schema, value) {',
          '+  if (!schema.safeParse(value).success) throw new Error("invalid")',
          '+}',
        ]),
      ]),
      change('src/api/server.ts', 'modified', 4, 2, [
        hunk('@@ -1,6 +1,6 @@', [
          '-import { createRouter } from "./routes"',
          '+import { createRouter } from "./routes"',
          '+import { logger } from "../utils/logger"',
          ' export function startServer(port: number) {',
        ]),
      ]),
    ],
  },

  // ---- main continuation --------------------------------------------------
  {
    sha: 'f2a3b4c',
    message: 'Add request validation middleware',
    author: 'Dana Ruiz',
    timestamp: '2026-01-28T13:15:00Z',
    branch: 'main',
    parents: ['e5f6a7b'],
    changes: [
      change('src/utils/validation.ts', 'modified', 22, 3, [
        hunk('@@ -1,8 +1,27 @@', [
          ' export function validate(schema, value) {',
          '-  if (!schema.safeParse(value).success) throw new Error("invalid")',
          '+  const result = schema.safeParse(value)',
          '+  if (!result.success) {',
          '+    throw new ValidationError(result.error.issues)',
          '+  }',
          '+  return result.data',
          ' }',
          '+',
          '+export function middleware(schema) {',
          '+  return (req, _res, next) => { validate(schema, req.body); next() }',
          '+}',
        ]),
      ]),
      change('src/api/UserController.ts', 'modified', 8, 2, [
        hunk('@@ -2,4 +2,6 @@', [
          ' import { validate } from "../utils/validation"',
          '+import { middleware } from "../utils/validation"',
          ' export const UserController = {',
          '-  create: async (req) => service.register(req.body.email, req.body.password),',
          '+  create: [middleware(userSchema), async (req) => service.register(req.body.email, req.body.password)],',
          ' }',
        ]),
      ]),
      change('src/api/OrderController.ts', 'modified', 6, 1, [
        hunk('@@ -2,3 +2,5 @@', [
          ' import { validate } from "../utils/validation"',
          '+import { middleware } from "../utils/validation"',
          ' export const OrderController = {',
        ]),
      ]),
    ],
  },
  {
    sha: 'a3b4c5d',
    message: 'Improve structured logging',
    author: 'Marcus Vale',
    timestamp: '2026-03-05T08:48:00Z',
    branch: 'main',
    parents: ['f2a3b4c'],
    changes: [
      change('src/utils/logger.ts', 'modified', 26, 6, [
        hunk('@@ -1,9 +1,29 @@', [
          '-export const logger = {',
          '-  info: (msg: string) => console.log("[info]", msg),',
          '-  error: (msg: string) => console.error("[error]", msg),',
          '-}',
          '+function emit(level: string, msg: string, meta?: object) {',
          '+  console.log(JSON.stringify({ level, msg, ...meta, ts: Date.now() }))',
          '+}',
          '+export const logger = {',
          '+  info: (msg: string, meta?: object) => emit("info", msg, meta),',
          '+  error: (msg: string, meta?: object) => emit("error", msg, meta),',
          '+}',
        ]),
      ]),
      change('src/services/AuthService.ts', 'modified', 5, 1, [
        hunk('@@ -4,4 +4,6 @@', [
          ' export async function login(email: string, password: string) {',
          '+  logger.info("login attempt", { email })',
          '   const user = await users.findByEmail(email)',
          '   return sign(user.id)',
          ' }',
        ]),
      ]),
      change('src/services/OrderService.ts', 'modified', 4, 0, [
        hunk('@@ -5,3 +5,5 @@', [
          '   const order = { id: uuid(), userId, total, status: "pending" }',
          '+  logger.info("order placed", { userId, total })',
          '   await orders.save(order)',
        ]),
      ]),
    ],
  },
  {
    sha: 'b4c5d6e',
    message: 'Fix token expiry off-by-one bug',
    author: 'Priya Shah',
    timestamp: '2026-07-30T17:59:00Z',
    branch: 'main',
    parents: ['a3b4c5d'],
    changes: [
      change('src/utils/tokens.ts', 'modified', 7, 3, [
        hunk('@@ -2,6 +2,10 @@', [
          ' export function sign(id: string) {',
          '   logger.info("issuing token")',
          '-  return jwt.sign({ id }, secret, { expiresIn: "1h" })',
          '+  // expiry was computed in seconds but compared in ms',
          '+  return jwt.sign({ id }, secret, { expiresIn: 60 * 60 })',
          ' }',
          '+export function isExpired(exp: number) {',
          '+  return Date.now() >= exp * 1000',
          '+}',
        ]),
      ]),
      change('src/services/AuthService.ts', 'modified', 3, 1, [
        hunk('@@ -6,3 +6,4 @@', [
          '   const user = await users.findByEmail(email)',
          '-  return sign(user.id)',
          '+  const token = sign(user.id)',
          '+  return { token, user }',
        ]),
      ]),
    ],
  },

  // ---- refactor branch (from e5f6a7b) ------------------------------------
  {
    sha: 'f6a7b8c',
    message: 'Introduce repository interfaces',
    author: 'Marcus Vale',
    timestamp: '2026-01-20T09:00:00Z',
    branch: 'refactor',
    parents: ['e5f6a7b'],
    changes: [
      change('src/repositories/UserRepository.ts', 'modified', 34, 12, [
        hunk('@@ -1,14 +1,30 @@', [
          ' import { db } from "../database/connection"',
          ' import type { User } from "../domain/User"',
          '+',
          '+export interface UserRepo {',
          '+  findById(id: string): Promise<User>',
          '+  findByEmail(email: string): Promise<User>',
          '+  create(input: NewUser): Promise<User>',
          '+}',
          '+',
          '-export async function findById(id: string): Promise<User> {',
          '-  return db().query("select * from users where id = $1", [id])',
          '-}',
          '+export const userRepo: UserRepo = {',
          '+  findById: (id) => db().query("select * from users where id = $1", [id]),',
          '+}',
        ]),
      ]),
      change('src/repositories/OrderRepository.ts', 'modified', 28, 8, [
        hunk('@@ -1,15 +1,33 @@', [
          ' import { db } from "../database/connection"',
          '+export interface OrderRepo {',
          '+  save(order: Order): Promise<Order>',
          '+  findByUser(userId: string): Promise<Order[]>',
          '+}',
          '+export const orderRepo: OrderRepo = {',
          '   save: (order) => db().query("insert into orders ...", [order]),',
          '+}',
        ]),
      ]),
    ],
  },
  {
    sha: 'a7b8c9d',
    message: 'Move DB access out of services into repositories',
    author: 'Marcus Vale',
    timestamp: '2026-02-02T15:30:00Z',
    branch: 'refactor',
    parents: ['f6a7b8c'],
    changes: [
      change('src/services/UserService.ts', 'modified', 24, 18, [
        hunk('@@ -1,15 +1,21 @@', [
          '-import * as users from "../repositories/UserRepository"',
          '+import { userRepo } from "../repositories/UserRepository"',
          ' import * as auth from "./AuthService"',
          ' export async function register(email: string, password: string) {',
          '-  const user = await users.create({ email, password })',
          '+  const user = await userRepo.create({ email, password })',
          '   return user',
          ' }',
        ]),
      ]),
      change('src/services/OrderService.ts', 'modified', 20, 15, [
        hunk('@@ -1,17 +1,23 @@', [
          '-import * as orders from "../repositories/OrderRepository"',
          '+import { orderRepo } from "../repositories/OrderRepository"',
          ' export async function placeOrder(userId: string, total: number) {',
          '-  await orders.save(order)',
          '+  await orderRepo.save(order)',
          ' }',
        ]),
      ]),
      change('src/services/AuthService.ts', 'modified', 14, 9, [
        hunk('@@ -1,16 +1,21 @@', [
          '-import * as users from "../repositories/UserRepository"',
          '+import { userRepo } from "../repositories/UserRepository"',
          ' import { sign } from "../utils/tokens"',
          '-  const user = await users.findByEmail(email)',
          '+  const user = await userRepo.findByEmail(email)',
        ]),
      ]),
      change('src/database/connection.ts', 'modified', 9, 2, [
        hunk('@@ -1,10 +1,17 @@', [
          ' let pool: Pool',
          '+export function withTransaction<T>(fn: (tx: Tx) => Promise<T>) {',
          '+  return db().transaction(fn)',
          '+}',
        ]),
      ]),
    ],
  },
  {
    sha: 'b8c9d0e',
    message: 'Slim down UserService',
    author: 'Marcus Vale',
    timestamp: '2026-02-15T12:10:00Z',
    branch: 'refactor',
    parents: ['a7b8c9d'],
    changes: [
      change('src/services/UserService.ts', 'modified', 12, 22, [
        hunk('@@ -1,21 +1,11 @@', [
          ' import { userRepo } from "../repositories/UserRepository"',
          '-import * as auth from "./AuthService"',
          '-import type { User } from "../domain/User"',
          '-',
          '-// a lot of orchestration used to live here',
          '-export async function register(email, password) { /* ...40 lines... */ }',
          '+export const register = (email: string, password: string) =>',
          '+  userRepo.create({ email, password })',
        ]),
      ]),
      change('src/api/UserController.ts', 'modified', 6, 6, [
        hunk('@@ -3,6 +3,6 @@', [
          ' export const UserController = {',
          '-  create: async (req) => service.register(req.body.email, req.body.password),',
          '+  create: async (req) => service.register(req.body),',
          ' }',
        ]),
      ]),
    ],
  },

  // ---- feature/payments branch (from e5f6a7b) ----------------------------
  {
    sha: 'c9d0e1f',
    message: 'Add payment domain model',
    author: 'Ivan Kozlov',
    timestamp: '2026-02-25T10:00:00Z',
    branch: 'feature/payments',
    parents: ['e5f6a7b'],
    changes: [
      change('src/domain/Payment.ts', 'added', 22, 0, [
        hunk('@@ -0,0 +1,11 @@', [
          '+export interface Payment {',
          '+  id: string',
          '+  orderId: string',
          '+  amount: number',
          '+  provider: "stripe" | "paypal"',
          '+  status: "authorized" | "captured" | "failed"',
          '+}',
        ]),
      ]),
      change('src/domain/Order.ts', 'modified', 3, 1, [
        hunk('@@ -1,9 +1,11 @@', [
          ' export interface Order {',
          '   status: "pending" | "paid"',
          '+  paymentId?: string',
          ' }',
        ]),
      ]),
    ],
  },
  {
    sha: 'd0e1f2a',
    message: 'Add payment service and gateway client',
    author: 'Ivan Kozlov',
    timestamp: '2026-03-14T14:25:00Z',
    branch: 'feature/payments',
    parents: ['c9d0e1f'],
    changes: [
      change('src/services/PaymentService.ts', 'added', 52, 0, [
        hunk('@@ -0,0 +1,19 @@', [
          '+import type { Payment } from "../domain/Payment"',
          '+import { logger } from "../utils/logger"',
          '+',
          '+export async function authorize(orderId: string, amount: number) {',
          '+  logger.info("authorizing payment", { orderId, amount })',
          '+  const res = await gateway.charge({ amount })',
          '+  return { id: res.id, orderId, amount, status: "authorized" } as Payment',
          '+}',
        ]),
      ]),
      change('src/utils/logger.ts', 'modified', 3, 0, [
        hunk('@@ -7,3 +7,6 @@', [
          '   error: (msg, meta) => emit("error", msg, meta),',
          '+  warn: (msg, meta) => emit("warn", msg, meta),',
          ' }',
        ]),
      ]),
      change('src/database/connection.ts', 'modified', 5, 0, [
        hunk('@@ -5,3 +5,8 @@', [
          '   return pool',
          '+// payments require a dedicated read replica',
          '+export function replica() { return replicaPool }',
        ]),
      ]),
    ],
  },
  {
    sha: 'e1f2a3b',
    message: 'Wire payments into order checkout',
    author: 'Ivan Kozlov',
    timestamp: '2026-04-02T11:40:00Z',
    branch: 'feature/payments',
    parents: ['d0e1f2a'],
    changes: [
      change('src/api/PaymentController.ts', 'added', 28, 0, [
        hunk('@@ -0,0 +1,11 @@', [
          '+import * as service from "../services/PaymentService"',
          '+export const PaymentController = {',
          '+  authorize: async (req) => service.authorize(req.body.orderId, req.body.amount),',
          '+}',
        ]),
      ]),
      change('src/services/OrderService.ts', 'modified', 16, 4, [
        hunk('@@ -1,17 +1,29 @@', [
          ' import * as orders from "../repositories/OrderRepository"',
          '+import * as payments from "./PaymentService"',
          ' export async function placeOrder(userId: string, total: number) {',
          '   const order = { id: uuid(), userId, total, status: "pending" }',
          '+  const payment = await payments.authorize(order.id, total)',
          '+  order.paymentId = payment.id',
          '   await orders.save(order)',
          ' }',
        ]),
      ]),
      change('src/api/routes.ts', 'modified', 5, 1, [
        hunk('@@ -1,12 +1,16 @@', [
          ' import { OrderController } from "./OrderController"',
          '+import { PaymentController } from "./PaymentController"',
          ' export function createRouter() {',
          '+  route("/payments", PaymentController)',
          ' }',
        ]),
      ]),
      change('src/api/OrderController.ts', 'modified', 4, 1, [
        hunk('@@ -3,4 +3,6 @@', [
          ' export const OrderController = {',
          '   create: async (req) => service.placeOrder(req.user.id, req.body.total),',
          '+  // now triggers a payment authorization',
          ' }',
        ]),
      ]),
    ],
  },
]

// --- static dependency graph (filtered by file existence per snapshot) -----

const dependencies = [
  ['src/api/server.ts', 'src/api/routes.ts'],
  ['src/api/routes.ts', 'src/api/UserController.ts'],
  ['src/api/routes.ts', 'src/api/OrderController.ts'],
  ['src/api/routes.ts', 'src/api/AuthController.ts'],
  ['src/api/routes.ts', 'src/api/PaymentController.ts'],
  ['src/api/UserController.ts', 'src/services/UserService.ts'],
  ['src/api/UserController.ts', 'src/utils/validation.ts'],
  ['src/api/OrderController.ts', 'src/services/OrderService.ts'],
  ['src/api/OrderController.ts', 'src/utils/validation.ts'],
  ['src/api/AuthController.ts', 'src/services/AuthService.ts'],
  ['src/api/PaymentController.ts', 'src/services/PaymentService.ts'],
  ['src/services/UserService.ts', 'src/repositories/UserRepository.ts'],
  ['src/services/UserService.ts', 'src/services/AuthService.ts'],
  ['src/services/UserService.ts', 'src/domain/User.ts'],
  ['src/services/AuthService.ts', 'src/repositories/UserRepository.ts'],
  ['src/services/AuthService.ts', 'src/utils/tokens.ts'],
  ['src/services/OrderService.ts', 'src/repositories/OrderRepository.ts'],
  ['src/services/OrderService.ts', 'src/domain/Order.ts'],
  ['src/services/OrderService.ts', 'src/services/PaymentService.ts'],
  ['src/services/PaymentService.ts', 'src/domain/Payment.ts'],
  ['src/services/PaymentService.ts', 'src/utils/logger.ts'],
  ['src/repositories/UserRepository.ts', 'src/database/connection.ts'],
  ['src/repositories/UserRepository.ts', 'src/domain/User.ts'],
  ['src/repositories/OrderRepository.ts', 'src/database/connection.ts'],
  ['src/repositories/OrderRepository.ts', 'src/domain/Order.ts'],
  ['src/database/migrations.ts', 'src/database/connection.ts'],
  ['src/utils/tokens.ts', 'src/utils/logger.ts'],
  ['tests/UserService.test.ts', 'src/services/UserService.ts'],
  ['tests/OrderService.test.ts', 'src/services/OrderService.ts'],
].map(([source, target]) => ({ source, target, type: 'import' as const }))

// tests are authored once at the branch point era; add them as an implicit
// initial presence via a synthetic commit so they appear on every branch.
commits.splice(5, 0, {
  sha: 'd4e5f60',
  message: 'Add service unit tests',
  author: 'Priya Shah',
  timestamp: '2025-12-18T09:30:00Z',
  branch: 'main',
  parents: ['d4e5f6a'],
  changes: [
    change('tests/UserService.test.ts', 'added', 24, 0, [
      hunk('@@ -0,0 +1,10 @@', [
        '+import { register } from "../src/services/UserService"',
        '+test("registers a user", async () => {',
        '+  const user = await register("a@b.co", "pw")',
        '+  expect(user.email).toBe("a@b.co")',
        '+})',
      ]),
    ]),
    change('tests/OrderService.test.ts', 'added', 22, 0, [
      hunk('@@ -0,0 +1,9 @@', [
        '+import { placeOrder } from "../src/services/OrderService"',
        '+test("places an order", async () => {',
        '+  const order = await placeOrder("u1", 42)',
        '+  expect(order.status).toBe("pending")',
        '+})',
      ]),
    ]),
  ],
})
// re-point e5f6a7b onto the tests commit so history stays linear on main
const apiCommit = commits.find((c) => c.sha === 'e5f6a7b')!
apiCommit.parents = ['d4e5f60']

const allFiles = Array.from(
  new Set(commits.flatMap((c) => c.changes.map((ch) => ch.path))),
).sort()

export const repo: RepoModel = {
  name: 'acme-commerce',
  defaultBranch: 'main',
  modules,
  files: allFiles,
  dependencies,
  commits,
  branches: [
    { id: 'main', head: 'b4c5d6e', branchedFrom: null, color: 'var(--branch-main)' },
    { id: 'refactor', head: 'b8c9d0e', branchedFrom: 'e5f6a7b', color: 'var(--branch-refactor)' },
    {
      id: 'feature/payments',
      head: 'e1f2a3b',
      branchedFrom: 'e5f6a7b',
      color: 'var(--branch-feature)',
    },
  ],
}
