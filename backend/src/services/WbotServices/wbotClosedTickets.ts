import { Op } from "sequelize";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import { getIO } from "../../libs/socket";
import formatBody from "../../helpers/Mustache";
import SendWhatsAppMessage from "./SendWhatsAppMessage";
import moment from "moment";
import ShowTicketService from "../TicketServices/ShowTicketService";
import { verifyMessage } from "./wbotMessageListener";
import TicketTraking from "../../models/TicketTraking";

export const ClosedAllOpenTickets = async (
  companyId: number
): Promise<void> => {
  const closeTicket = async (ticket: any, currentStatus: any, body: any) => {
    if (currentStatus === "nps" || currentStatus === "open") {
      await ticket.update({
        status: "closed",
        lastMessage: body,
        unreadMessages: 0,
        amountUseBotQueues: 0
      });
    } else {
      await ticket.update({
        status: "closed",
        unreadMessages: 0
      });
    }
  };

  const io = getIO();
  try {
    const { rows: tickets } = await Ticket.findAndCountAll({
      where: { status: { [Op.in]: ["open"] }, companyId },
      order: [["updatedAt", "DESC"]]
    });

    for (const ticket of tickets) {
      const showTicket = await ShowTicketService(ticket.id, companyId);
      const whatsapp = await Whatsapp.findByPk(showTicket?.whatsappId);
      const ticketTraking = await TicketTraking.findOne({
        where: {
          ticketId: ticket.id,
          finishedAt: null
        }
      });

      if (!whatsapp) continue;

      let {
        expiresInactiveMessage, // mensaje de encerramento por inatividade
        expiresTicket // tiempo en horas para fechar ticket automaticamente
      } = whatsapp;

      if (
        expiresTicket &&
        expiresTicket.toString() !== "" &&
        expiresTicket.toString() !== "0" &&
        Number(expiresTicket) > 0
      ) {
        const bodyExpiresMessageInactive = formatBody(
          `\u200e ${expiresInactiveMessage}`,
          showTicket.contact
        );

        const dataLimite = new Date();
        dataLimite.setMinutes(dataLimite.getMinutes() - Number(expiresTicket));

        if (showTicket.status === "open" && !showTicket.isGroup) {
          const dataUltimaInteracaoChamado = new Date(showTicket.updatedAt);

          if (dataUltimaInteracaoChamado < dataLimite && showTicket.fromMe) {
            await closeTicket(
              showTicket,
              showTicket.status,
              bodyExpiresMessageInactive
            );

            if (
              expiresInactiveMessage !== "" &&
              expiresInactiveMessage !== undefined
            ) {
              const sentMessage = await SendWhatsAppMessage({
                body: bodyExpiresMessageInactive,
                ticket: showTicket
              });

              await verifyMessage(sentMessage, showTicket, showTicket.contact);
            }

            await ticketTraking.update({
              finishedAt: moment().toDate(),
              closedAt: moment().toDate(),
              whatsappId: ticket.whatsappId,
              userId: ticket.userId
            });

            io.to("open").emit(`company-${companyId}-ticket`, {
              action: "delete",
              ticketId: showTicket.id
            });
          }
        }
      }
    }
  } catch (e: any) {
    console.log("Error:", e);
  }
};
