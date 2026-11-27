package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/crocchetto/ggst-go/auth"
	"github.com/crocchetto/ggst-go/ggst"
)

// Helper de una sola ejecución: pide a Steam un ticket para GGST, entra en la
// API de replays e imprime el token y el Player ID para pegarlos en el panel
// del overlay.
func main() {
	if err := auth.Init(); err != nil {
		log.Fatal(err)
	}
	creds, err := auth.Acquire()
	if err != nil {
		log.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	client := ggst.NewClient("")
	sess, err := client.Login(ctx, creds.SteamID, creds.SteamHex, creds.Ticket)
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println()
	fmt.Println("==================================================")
	fmt.Println("Copia estos dos valores en el panel del overlay:")
	fmt.Println()
	fmt.Println("Token de sesión:")
	fmt.Println(sess.Token)
	fmt.Println()
	fmt.Println("Player ID:")
	fmt.Println(sess.PlayerID)
	fmt.Println("==================================================")
	fmt.Println("El token caduca cuando lo caduca el servidor del juego:")
	fmt.Println("si el panel avisa, vuelve a ejecutar este helper.")
}
