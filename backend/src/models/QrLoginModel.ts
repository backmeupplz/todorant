import { getModelForClass, index, prop } from '@typegoose/typegoose'

@index({ createdAt: 1 }, { expireAfterSeconds: 600 })
export class QrLogin {
  @prop({ index: true })
  token?: string

  @prop({ required: true, unique: true, index: true })
  uuid: string

  /** sha256 of a secret only the browser showing the code knows; /qr_check then requires the secret */
  @prop()
  secretHash?: string
}

export const QrLoginModel = getModelForClass(QrLogin, {
  schemaOptions: { timestamps: true },
})
